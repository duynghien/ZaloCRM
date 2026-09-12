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

# Database Password (BẮT BUỘC ĐẶT MẬT KHẨU MẠNH)
DB_USER=crmuser
DB_PASSWORD=Dat_Mat_Khau_Database_Sieu_Cap_Bi_Mat_At_Here!
DB_NAME=zalocrm

# Security Keys (BẮT BUỘC TẠO 2 KHÓA 64 KÝ TỰ HEX ĐỘC LẬP)
JWT_SECRET=
ENCRYPTION_KEY=
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
- [ ] Chặn SSRF cho webhook/attachment URL, gồm DNS, IPv6 và redirect chain.
- [x] Mã hóa webhook secret và SMTP password ở database/backups. Public API key vẫn plaintext/recoverable theo residual-risk waiver đã chấp nhận; chỉ Owner/Admin được xem, response phải `Cache-Control: no-store`, có audit trail và không log giá trị secret.
- [ ] Đóng toàn bộ finding high/moderate được chấp nhận từ dependency audit.

> [!CAUTION]
> Checklist chưa hoàn tất đồng nghĩa bản hiện tại chưa đạt production security baseline, dù container đã chạy bằng `USER node` và chỉ publish port lên loopback.


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
