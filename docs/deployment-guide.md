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
docker compose up -d --build
```

Kiểm tra trạng thái container:
```bash
docker compose ps
```
Cả 3 dịch vụ `zalo-crm-app`, `zalo-crm-db`, `zalo-crm-backup` phải ở trạng thái `Up` (healthy).

---

## 3. Quản Lý Cơ Sở Dữ Liệu & Khởi Tạo Dữ Liệu (Database Setup & Seeding)

### 3.1. Đồng bộ Schema (Database Schema Sync)
- **Production:** Dockerfile chạy `npx prisma migrate deploy --config prisma.config.ts` trước khi khởi động ứng dụng. Nếu migration thất bại, container không được chạy app; không có fallback `prisma db push`.
- **Database trống:** `migrate deploy` áp dụng toàn bộ migration theo thứ tự.
- **Database có từ trước migration:** bắt buộc backup và rehearsal restore trước. Sau đó chỉ đánh dấu baseline đã review là applied, rồi mới deploy phần migration còn lại:
  ```bash
  docker exec -it zalo-crm-app npx prisma migrate resolve \
    --config prisma.config.ts --applied 00000000000000_baseline

  docker exec -it zalo-crm-app npx prisma migrate deploy --config prisma.config.ts
  docker exec -it zalo-crm-app npx prisma migrate status --config prisma.config.ts
  ```
- Không đánh dấu migration nếu schema fingerprint của bản restore rehearsal không khớp database nguồn; khôi phục từ backup thay vì chạy `db push` để sửa rollout lỗi.

### 3.2. Khởi tạo Dữ liệu Mẫu (Database Seeding)
Nếu muốn khởi tạo Tổ chức mặc định và tài khoản Admin mẫu, chạy lệnh:
```bash
# Chạy trực tiếp từ root (nếu cài đặt NodeJS local)
npm run db:seed

# Hoặc chạy bên trong container Docker
docker exec -it zalo-crm-app npm run db:seed
```

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
Container `zalo-crm-backup` tự động tạo bản sao lưu mỗi ngày lúc 00:00 và lưu trữ tại thư mục `./backups` theo chính sách:
- **7 bản sao lưu ngày** (Daily)
- **4 bản sao lưu tuần** (Weekly)
- **3 bản sao lưu tháng** (Monthly)

### 5.2. Sao lưu Thủ công
```bash
# Tạo file backup cơ sở dữ liệu ngay lập tức
docker exec zalo-crm-db pg_dump -U crmuser zalocrm > backup-manual-$(date +%Y%m%d).sql
```

### 5.3. Khôi phục Dữ liệu từ File Backup
```bash
# Khôi phục dữ liệu từ file sql vào database
cat backup-manual-20260813.sql | docker exec -i zalo-crm-db psql -U crmuser zalocrm
```

---

## 6. Danh Mục Hardening Bảo Mật (Security Checklist)

- [x] Không để cổng PostgreSQL 5432 mở ra ngoài Internet public (chỉ dùng kết nối nội bộ hoặc Docker network).
- [x] Chạy container ứng dụng dưới tài khoản phi đặc quyền `USER node`.
- [x] Không lưu trữ mật khẩu DB hoặc Secret key mặc định trong phiên bản production.
- [x] Kích hoạt tường lửa UFW chỉ mở cổng `80`, `443`, `22` (SSH).
- [ ] Nâng image khỏi Node.js 20 đã EOL lên Node.js LTS còn được hỗ trợ.
- [x] Thêm `.dockerignore`; không gửi `.env`, `.git`, `node_modules`, backup và build artifact vào Docker context.
- [x] Dùng root workspace `package-lock.json` làm nguồn duy nhất; Docker build và CI đều chạy clean `npm ci` từ root.
- [x] Thay `prisma db push` bằng migration có version và `prisma migrate deploy`.
- [ ] Chặn SSRF cho webhook/attachment URL, gồm DNS, IPv6 và redirect chain.
- [ ] Mã hóa API key, webhook secret và SMTP password ở database/backups.
- [ ] Đóng toàn bộ finding high/moderate được chấp nhận từ dependency audit.

> [!CAUTION]
> Checklist chưa hoàn tất đồng nghĩa bản hiện tại chưa đạt production security baseline, dù container đã chạy bằng `USER node` và chỉ publish port lên loopback.
