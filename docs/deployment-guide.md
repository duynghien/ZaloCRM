# ZaloCRM — Deployment & Operations Guide

## 1. Yêu Cầu Hệ Thống (System Requirements)

### 1.1. Cấu hình Phần cứng VPS
| Môi trường | CPU | RAM | Ổ cứng | Hệ điều hành |
|-----------|-----|-----|--------|--------------|
| **Tối thiểu** | 1 vCPU | 1 GB | 10 GB SSD | Ubuntu 20.04 LTS / Debian 11 |
| **Khuyến nghị** | 2-4 vCPU | 4 GB | 20 GB SSD | Ubuntu 22.04 LTS |

### 1.2. Phần mềm Yêu cầu
- **Docker Engine:** 24.0+
- **Docker Compose:** v2.20+
- **Node.js 24 LTS và npm trên máy chủ:** chạy deployment gate bằng module có sẵn của Node; không cần cài dependency ứng dụng trên host để deploy.
- **OpenSSL:** Để tạo chìa khóa mã hóa bí mật.

---

## 2. Quy Trình Cài Đặt Nhanh (Production Quickstart)

### Bước 1: Tải mã nguồn dự án
```bash
git clone https://github.com/duynghien/ZaloCRM.git
cd ZaloCRM
```

### Bước 2: Thiết lập biến môi trường an toàn
```bash
cp .env.example .env
```

Mở file `.env` và cập nhật các thông số bảo mật bắt buộc:

```env
# Server Config
PORT=3000
NODE_ENV=production
APP_URL=https://crm.domain-cua-ban.com
TRUSTED_PROXY_HOPS=1 # Số proxy hops tin cậy (1 cho Nginx/Cloudflare/Traefik; 0 nếu expose trực tiếp)

# Database Password (BẮT BUỘC ĐẶT MẬT KHẨU MẠNH)
DB_USER=crmuser
DB_PASSWORD=Dat_Mat_Khau_Database_Sieu_Cap_Bi_Mat_At_Here!
DB_NAME=zalocrm

# Security Keys (BẮT BUỘC TẠO 2 KHÓA 64 KÝ TỰ HEX ĐỘC LẬP)
JWT_SECRET=
ENCRYPTION_KEY=

# AI Multi-Provider & Gateway Network Isolation
# Mặc định: false (nghiêm cấm AI Gateway trỏ về IP Private/Loopback/Metadata để chống SSRF).
# Chỉ đặt true nếu bạn tự host Ollama / vLLM / LiteLLM trên mạng nội bộ LAN.
ALLOW_PRIVATE_AI_GATEWAYS=false
```

**Tạo 2 khóa mã hóa ngẫu nhiên 256-bit bằng OpenSSL:**
```bash
# Tạo JWT_SECRET và dán vào file .env
openssl rand -hex 32

# Tạo ENCRYPTION_KEY và dán vào file .env
openssl rand -hex 32
```

### Bước 3: Khởi chạy ứng dụng với Docker Compose
```bash
# Build và chạy ứng dụng dưới dạng background service
npm run docker:up
```

Kiểm tra trạng thái container:
```bash
docker compose ps
```
`app` và `db` phải healthy, `backup` phải chạy; `migrator` hoàn tất với exit code 0 (xem `docker compose ps -a`). Tên container do Compose project quản lý; dùng tên service trong lệnh vận hành.

> [!NOTE]
> **Cấu hình Database Healthcheck chuẩn:**
> Service `db` trong `docker-compose.yml` bắt buộc sử dụng:
> `test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-crmuser} -d ${DB_NAME:-zalocrm}"]`
> Tham số `-d ${DB_NAME:-zalocrm}` chỉ định chính xác tên database cần probe. Nếu thiếu `-d`, `pg_isready` sẽ mặc định kết nối vào database trùng tên với user (`crmuser`), làm phát sinh hàng chục ngàn dòng log `FATAL: database "crmuser" does not exist` làm tràn bộ đệm log trên Docker và OrbStack.

> [!IMPORTANT]
> **Giới Hạn Topology 1 Replica (Quyết định 4):**
> Phiên bản hiện tại bắt buộc chạy đúng **1 instance** service `app`. Tuyệt đối không scale nhiều replica (`docker compose up --scale app=N` với `N > 1`), vì Zalo SDK quản lý phiên kết nối đơn và Socket.IO hub sử dụng adapter bộ nhớ trong. Deployment gate sẽ tự động từ chối và chặn triển khai nếu phát hiện cấu hình replica > 1 hoặc nhiều hơn 1 container `app` đang chạy.

Dùng cùng lệnh `npm run docker:up` cho mọi lần cập nhật. Gate build và ghim ID của hai image, dừng app cũ với thời gian chờ 70 giây, rồi yêu cầu trạng thái đã dừng, exit code 0 và không OOM. App đóng admission khi nhận SIGTERM và chờ công việc đang chạy kết thúc. Timeout hoặc exit khác 0 chặn migration; operator cần đối soát công việc chưa hoàn tất trước khi thử lại.

Sau khi drain thành công, gate tạo lại migrator, chờ exit code 0 rồi mới thay app và chờ healthy. Job migrator thành công của lần trước không được tái sử dụng. Lỗi migration giữ app ở trạng thái dừng. Xem `docker compose logs app migrator` để xử lý nguyên nhân; không khởi chạy app riêng để vượt gate. Deployment bị ngắt có thể giữ khóa `zalocrm-deploy-<project>.lock` trong thư mục tạm hệ điều hành: chỉ xóa khóa sau khi xác minh không còn deployment đang chạy và đã đối soát trạng thái app/migration.

`/health` kiểm tra các migration bắt buộc cùng checksum đóng gói trong backend build. Schema thiếu hoặc không khớp trả 503. Runtime chỉ mang dependency production backend và Prisma client đã generate; Prisma CLI nằm trong image migrator riêng. Cả hai lấy dependency từ cùng root lockfile, chạy bằng user `node`; migration dùng CLI local, không tải qua `npx` lúc startup.

---

## 3. Quản Lý Cơ Sở Dữ Liệu & Khởi Tạo Dữ Liệu (Database Setup & Seeding)

### 3.1. Đồng bộ Schema (Database Schema Sync)
- **Production:** `npm run docker:up` chạy job migrator với local Prisma CLI trước app. Không có fallback `prisma db push`.
- **Database trống:** `migrate deploy` áp dụng toàn bộ migration theo thứ tự.
- **Database có từ trước migration:** bắt buộc backup và rehearsal restore trước. Sau đó chỉ đánh dấu baseline đã review là applied, rồi mới deploy phần migration còn lại:
  ```bash
  # Chỉ thực hiện sau khi app đã drain sạch và dừng; DB đang healthy.
  docker compose run --rm --no-deps migrator \
    node node_modules/prisma/build/index.js migrate resolve \
    --config backend/prisma.config.ts --applied 00000000000000_baseline

  npm run docker:up
  docker compose run --rm --no-deps migrator \
    node node_modules/prisma/build/index.js migrate status --config backend/prisma.config.ts
  ```
- Không đánh dấu migration nếu schema fingerprint của bản restore rehearsal không khớp database nguồn; khôi phục từ backup thay vì chạy `db push` để sửa rollout lỗi.

### 3.2. Kiểm kê dữ liệu trước nâng cấp

Trên bản database đã restore để rehearsal, dùng toolchain local sau `npm ci`. Cấp riêng biến `REPORT_TARGET_PREFLIGHT_DATABASE_URL` và `ORDER_CODE_PREFLIGHT_DATABASE_URL` qua môi trường bảo mật; hai script không tự lấy `DATABASE_URL`. Thư mục đầu ra phải tồn tại, nằm ngoài repository và được bảo vệ:

```bash
node --import tsx backend/scripts/report-target-migration-preflight.ts /protected/report-targets.json
node --import tsx backend/scripts/order-code-preflight.ts /protected/order-codes.json
```

Artifact được tạo mới với quyền `0600`, chứa ID, số lượng và lý do phân loại; không ghi đè file có sẵn. Order preflight trả exit `2` nếu trùng mã hoặc counter đã cạn: cần xử lý dữ liệu trước migration, không tự đổi mã đơn. Exit `1` là lỗi kiểm kê. Sau rehearsal, thực hiện cùng kiểm kê trên database đích trước cutover và lưu cùng bản backup được bảo vệ.

Migration AI giữ cấu hình có account hợp lệ, chỉ tự resolve cấu hình cũ khi nguồn duy nhất. Nguồn thiếu hoặc mơ hồ bị tắt để Owner/Admin chọn lại account. Report lịch sử chưa xác minh nguồn chỉ được xem bởi Owner/Admin, không gửi lại; job v1 chưa kết thúc chuyển failed và cần tạo yêu cầu mới. Ledger gửi cũ được giữ để đối soát. Migration order giữ mã hiện có, seed counter theo org/ngày UTC và dừng nếu phát hiện mã trùng. Khi migration thất bại, giữ app dừng, xem log và đối soát trước khi retry; không chạy binary cũ với schema mới.

### 3.3. Khởi tạo Dữ liệu Mẫu (Database Seeding)
Production: tạo Owner qua màn hình thiết lập ban đầu. Để seed dữ liệu trong môi trường development đã cấu hình `DATABASE_URL`, dùng toolchain local:
```bash
npm ci
npm run db:seed
```

Runtime production không chứa tsx hoặc seed script.

---

## 4. Thiết Lập Reverse Proxy & SSL/TLS

Ứng dụng lắng nghe tại `127.0.0.1:3080`. Bạn cần cấu hình Reverse Proxy để cấp SSL HTTPS.

### Cách 1: Cấu hình Nginx + Certbot Let's Encrypt

1. **Cài đặt Nginx & Certbot:**
   ```bash
   sudo apt update
   sudo apt install nginx certbot python3-certbot-nginx -y
   ```

2. **Sao chép cấu hình Nginx mẫu:**
   ```bash
   sudo cp docker/nginx.conf /etc/nginx/sites-available/zalocrm.conf
   sudo ln -s /etc/nginx/sites-available/zalocrm.conf /etc/nginx/sites-enabled/
   ```

3. **Chỉnh sửa tên domain trong file cấu hình:**
   ```bash
   sudo nano /etc/nginx/sites-available/zalocrm.conf
   ```
   Thay thế `your-domain.com` thành tên miền thực tế của bạn.

4. **Cấp chứng chỉ SSL miễn phí:**
   ```bash
   sudo certbot --nginx -d crm.domain-cua-ban.com
   sudo systemctl reload nginx
   ```

---

### Cách 2: Cấu hình Cloudflare Tunnel (Khuyên dùng cho mạng nội bộ)

1. **Cài đặt cloudflared:**
   ```bash
   curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
   chmod +x cloudflared
   sudo mv cloudflared /usr/local/bin/
   ```

2. **Đăng nhập & Tạo Tunnel:**
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create zalocrm
   ```

3. **Cấu hình file `config.yml`:**
   ```yaml
   tunnel: <YOUR_TUNNEL_ID>
   credentials-file: /root/.cloudflared/<YOUR_TUNNEL_ID>.json
   ingress:
     - hostname: crm.domain-cua-ban.com
       service: http://127.0.0.1:3080
     - service: http_status:404
   ```

4. **Kích hoạt Service:**
   ```bash
   cloudflared tunnel route dns zalocrm crm.domain-cua-ban.com
   sudo cloudflared service install
   ```

---

## 5. Quy Trình Sao Lưu & Khôi Phục Dữ Liệu (Backup & Recovery)

### 5.1. Tự động Sao lưu
Service `backup` tự động tạo bản sao lưu mỗi ngày lúc 00:00 và lưu trữ tại thư mục `./backups` theo chính sách:
- **7 bản sao lưu ngày** (Daily)
- **4 bản sao lưu tuần** (Weekly)
- **3 bản sao lưu tháng** (Monthly)

### 5.2. Sao lưu Thủ công
```bash
# Tạo file backup cơ sở dữ liệu ngay lập tức
docker compose exec -T db pg_dump -U crmuser zalocrm > backup-manual-$(date +%Y%m%d).sql
```

### 5.3. Khôi phục Dữ liệu từ File Backup
```bash
# Khôi phục dữ liệu từ file sql vào database
docker compose exec -T db psql -U crmuser zalocrm < backup-manual-20260813.sql
```

### 5.4. Khôi Phục Khóa Cron Lease (Operator Tool)
Khi có sự cố worker crash hoặc đọng khóa lease trên bảng `cron_job_leases`:
API tenant không còn chứa route reset lease để đảm bảo cô lập quyền hạn. Người vận hành hệ thống sử dụng script CLI với audit log bắt buộc:
```bash
# Reset một khóa cụ thể
npm run operator:reset-cron-leases -- --actor "devops@example.com" --reason "Worker node-1 crash recovery" --lock-id 1001

# Reset toàn bộ các khóa hệ thống (yêu cầu cờ xác nhận tường minh)
npm run operator:reset-cron-leases -- --actor "devops@example.com" --reason "Cluster recovery after failover" --all --confirm-all
```
Mọi thao tác reset đều được lưu vết trong bảng `cron_job_lease_resets`.

---

## 6. Danh Mục Hardening Bảo Mật (Security Checklist)

- [x] Không để cổng PostgreSQL 5432 mở ra ngoài Internet public (chỉ dùng kết nối nội bộ hoặc Docker network).
- [x] Chạy container ứng dụng dưới tài khoản phi đặc quyền `USER node`.
- [x] Không lưu trữ mật khẩu DB hoặc Secret key mặc định trong phiên bản production.
- [x] Kích hoạt tường lửa UFW chỉ mở cổng `80`, `443`, `22` (SSH).
- [x] Dùng Node.js 24 LTS trong production và development images.
- [x] Thêm `.dockerignore`; không gửi `.env`, `.git`, `node_modules`, backup và build artifact vào Docker context.
- [x] Dùng root workspace `package-lock.json` làm nguồn duy nhất; Docker build và CI đều chạy clean `npm ci` từ root.
- [x] Thay `prisma db push` bằng migration có version và `prisma migrate deploy`.
- [x] Chặn SSRF cho webhook/attachment URL (`outbound-url-policy.ts`), kiểm tra DNS, chặn private IPv4/IPv6 và giới hạn tối đa 3 lần redirect.
- [x] Chống SSRF cho AI Gateway tùy chỉnh (`validateCustomAiGatewayUrl`): Tự động chặn các địa chỉ IP nội bộ RFC1918, loopback và metadata instance; chỉ cho phép mở khi `ALLOW_PRIVATE_AI_GATEWAYS=true` được thiết lập tường minh cho hạ tầng private nội bộ.
- [x] Lọc và khử khuẩn nội dung đầu vào AI (`sanitizeConversationHistory`): Vô hiệu hóa kỹ thuật Prompt Injection trong lịch sử chat khách hàng, giới hạn kích thước tệp đính kèm tối đa 12MB và pool burst sampling 4 worker đồng thời.
- [x] Khử khuẩn nội dung hiển thị Báo cáo AI qua `DOMPurify` phía frontend, ngăn chặn triệt để Stored XSS từ kết quả trả về của LLM.
- [x] Mã hóa webhook secret và SMTP password ở database/backups (`secure-setting-codec.ts`). Public API key vẫn plaintext/recoverable theo residual-risk waiver đã chấp nhận; chỉ Owner/Admin được xem, response phải `Cache-Control: no-store`, có audit trail và không log giá trị secret.
- [x] Thực thi chính sách kiểm toán phụ thuộc nghiêm ngặt (`scripts/audit-production-policy.mjs`), chỉ cho phép 2 waiver cố định version/path cho Prisma CLI upstream (`deepmerge-ts` / `GHSA-ggr8-5vv4-36mx`, `mysql2` / `GHSA-3f6p-5ww8-9rcr`); cấm mọi waiver cho `uuid`.
- [x] Giới hạn số reverse proxy hops được tin cậy (`TRUSTED_PROXY_HOPS`, mặc định `1`) trong Fastify thay vì tin cậy vô điều kiện (`trustProxy: true`), ngăn chặn giả mạo IP client qua header `X-Forwarded-For` khi bị tấn công spoofing.

> [!NOTE]
> Tất cả các tiêu chí bảo mật cơ bản đã được cài đặt và kiểm chứng qua bộ kiểm thử tự động. Quá trình release cần chạy `npm run audit:production` để xác thực toàn vẹn phụ thuộc trước khi triển khai.


## 7. Development và container smoke

```bash
npm run docker:dev
```

Compose development chạy hai process riêng: backend `tsx watch` và Vite. Trình duyệt mở **http://localhost:5173**; backend publish **http://localhost:3080**. Vite cố định port 5173 (`strictPort`) và proxy `/api`, `/socket.io` tới `http://app:3000`. Với Vite chạy trên host, upstream mặc định là `http://localhost:3000`.

`DEV_APP_URL` đặt origin trình duyệt cho backend development, mặc định `http://localhost:5173`; không kế thừa `APP_URL` production. Ví dụ khi dùng địa chỉ loopback khác:

```bash
DEV_APP_URL=http://127.0.0.1:5173 npm run docker:dev
```

Backend/frontend chỉ mount source, giữ dependency trong image. Thay đổi dependency hoặc cấu hình backend cần rebuild. Giữ Origin/CSRF checks và đặt URL đúng với trình duyệt. Dừng development bằng `docker compose -f docker-compose.dev.yml down`.

Smoke cần Docker, dependency local từ root lockfile và Chromium của Playwright:

```bash
npm ci
npm exec --workspace=frontend -- playwright install chromium
npm run verify:production-container
npm run verify:development-compose
```

| Smoke | Compose project | Cổng host |
|---|---|---|
| Production | `zalocrm-prod-contract` | app 13080, DB 15433 |
| Development | `zalocrm-dev-contract` | backend 13081, Vite 15173, DB 15434 |

Scripts dùng cấu hình giả lập trong thư mục tạm, database riêng, không đọc `.env` của operator. Nếu cổng bị chiếm hoặc project fixture đã có tài nguyên, script dừng để kiểm tra chủ sở hữu. Sau test, container/volume/network fixture được dọn; image build được giữ để kiểm inventory. Dev smoke sửa bản sao source riêng và kiểm browser login/reload/refresh/logout, foreign Origin, WebSocket, Vue HMR và backend reload.

Production smoke kiểm dependency inventory, CLI offline, UI/API/socket, readiness khi checksum sai, migrator được tạo mới, migration thất bại, drain exit khác 0 và phục hồi. Một process bỏ qua SIGTERM bị buộc dừng sau 70 giây với exit 137; gate phải giữ nguyên migrator. Smoke cũng dump/restore vào database fixture thứ hai, kiểm dữ liệu và checksum migration trước/sau chạy lại migrator. Inventory nằm trong image tại `/app/runtime-dependencies.json` và `/app/migrator-dependencies.json`.

---

## 8. Vận Hành Tích Hợp KiotViet (KiotViet Integration Operations)

### 8.1. Cấu hình & Bảo mật Thông tin Đăng nhập (Credentials & Secrets)
- Thông tin xác thực KiotViet (Client ID, Client Secret, Mã gian hàng / Retailer, Chi nhánh / Branch ID) được cấu hình tại mục **Cài đặt -> KiotViet** (chỉ dành cho Owner/Admin).
- **Mã hóa AES-256-GCM:** Client Secret được mã hóa ngay khi lưu vào cơ sở dữ liệu (`app_settings`), sử dụng `ENCRYPTION_KEY` từ file `.env`. Tuyệt đối không lưu trữ bí mật dạng plaintext hay ghi ra log hệ thống.
- **Xoay vòng thông tin (Key Rotation):** Khi cập nhật Client Secret, các hóa đơn đã xuất thành công không bị ảnh hưởng. Nếu thay đổi Mã gian hàng (Retailer), hệ thống tự động:
  - Tăng số hiệu phiên bản cấu hình (`configRevision`).
  - Hủy các công việc đang chờ xử lý (`queued`/`preparing`) thuộc phiên bản cũ.
  - Đặt lại con trỏ đồng bộ danh mục (`catalogCursor = null`, `catalogReady = false`) để yêu cầu đồng bộ toàn bộ (Full Sync).

### 8.2. Quy trình Đối Soát Hóa Đơn Trạng Thái Nghi Vấn (Uncertain Invoice Reconciliation)
- Khi quá trình gửi hóa đơn sang KiotViet gặp sự cố mạng (timeout, lỗi 5xx, ngắt kết nối socket), công việc sẽ chuyển sang trạng thái **Cần đối soát (uncertain)** và **tuyệt đối không tự động gửi lại** để tránh xuất trùng hóa đơn tài chính.
- Đơn hàng sẽ bị khóa sửa đổi tài chính. Người quản trị (Owner/Admin) cần:
  1. Kiểm tra trên portal KiotViet xem đơn hàng đã được tạo hóa đơn hay chưa.
  2. Truy cập màn hình **Quản lý Đơn hàng** trên ZaloCRM, bấm nút **Đối soát** trên đơn hàng có trạng thái nghi vấn.
  3. Chọn 1 trong 3 hành động:
     - **Liên kết (Link):** Nhập ID hóa đơn đã tìm thấy trên KiotViet để khớp nối với đơn hàng CRM.
     - **Xác nhận chưa tạo (Confirm Not Created):** Nhập lý do xác nhận (tối thiểu 5 ký tự) để mở khóa đơn hàng, chuyển trạng thái hóa đơn sang Thất bại để nhân viên có thể sửa đổi hoặc xuất lại.
     - **Làm mới (Refresh):** Gọi KiotViet để cập nhật lại thông tin mới nhất của hóa đơn đã liên kết.

### 8.3. Chu trình Dừng & Khởi Động An Toàn (Graceful Shutdown & Workers Drain)
- Ứng dụng tuân thủ chu trình tắt 3 bước nghiêm ngặt:
  1. **Đóng HTTP Server & Ngắt WebSocket:** Ngừng tiếp nhận mọi request và sự kiện mới từ người dùng.
  2. **Xả trơn tru các Worker nền (Drain Background Workers):** Chờ các worker đang xử lý hoàn tất công việc hiện tại:
     - `stopCatalogWorker()`: Nhả lease đồng bộ danh mục sản phẩm.
     - `stopInvoiceWorker()`: Hoàn tất đợt dispatch hóa đơn hiện hành, trả lease về trạng thái an toàn.
     - `stopReportJobWorker()`, `stopAppointmentReminder()`, `stopOrphanCleanupTask()`, `stopNotificationCleanupTask()`.
  3. **Ngắt kết nối Cơ sở dữ liệu:** Thực hiện `prisma.$disconnect()` sau cùng.
- Cơ chế này loại bỏ hoàn toàn hiện tượng đơn hàng bị kẹt trạng thái dở dang hoặc mất mát dữ liệu tài chính khi restart hệ thống.

---

## 9. Quy Tắc Bảo Vệ Nhánh & CI/CD Gate Bắt Buộc (Branch Protection & Required Status Checks)

Để đảm bảo an toàn tuyệt đối cho nhánh `main` và ngăn chặn mã lỗi, rò rỉ bảo mật hoặc sai lệch schema lọt vào môi trường production, repository GitHub bắt buộc cấu hình **Branch Protection Rules** trên nhánh `main`:

### 9.1. 6 CI Status Checks Bắt Buộc (Required Status Checks)
Mọi Pull Request muốn merge vào `main` bắt buộc phải vượt qua toàn bộ 6 jobs định nghĩa trong `.github/workflows/ci.yml`:

| Check Name | Job ID | Mục Đích Kiểm Soát |
|---|---|---|
| **Typecheck** | `typecheck` | Kiểm tra TypeScript typecheck toàn diện trên cả backend và frontend. |
| **Backend Tests** | `test-backend` | Chạy toàn bộ unit tests, integration tests và mock tests của backend. |
| **Frontend Tests** | `test-frontend` | Chạy toàn bộ unit tests frontend (Vitest). |
| **E2E Tests** | `test-e2e` | Chạy integration & E2E tests trên PostgreSQL thật (`postgres:16-alpine`), kiểm chứng multi-tenant isolation, concurrency và idempotency. |
| **Audit and Build** | `audit-and-build` | Quét lỗ hổng phụ thuộc production (`audit:production`) và kiểm tra build artifact của cả frontend và backend. |
| **Container Verification** | `container-verify` | Khởi chạy Docker Compose container verification, kiểm thử multi-stage build, migration deploy và healthcheck endpoint. |

### 9.2. Quy Định Enforcement Bắt Buộc (Non-Bypassable Rules)
- **Require a pull request before merging:** Mọi thay đổi bắt buộc đi qua Pull Request, cấm push trực tiếp vào `main`.
- **Require status checks to pass before merging:** Bắt buộc tích xanh cả 6 jobs trên.
- **Require branches to be up to date before merging:** Nhánh PR phải được rebase/merge mới nhất so với `main`.
- **Do not allow bypassing the above settings:** Áp dụng nghiêm ngặt cho cả Administrators / Repository Owners. Không có ngoại lệ bypass CI gate.
- **Do not allow force pushes & Do not allow deletions:** Cấm `git push --force` và xóa nhánh `main`.
