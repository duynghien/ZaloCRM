# Hướng dẫn cài đặt ZaloCRM

## Bước 1: Chuẩn bị VPS

Bạn cần 1 VPS (máy chủ ảo) chạy Linux. Có thể dùng:
- DigitalOcean, Vultr, Linode, AWS, Google Cloud, hoặc VPS Việt Nam

**Cấu hình tối thiểu:** 1 vCPU, 1 GB RAM, 10 GB ổ cứng

### Cài Docker (nếu chưa có)

Đăng nhập VPS qua SSH, chạy lệnh:

```bash
# Cài Docker
curl -fsSL https://get.docker.com | sudo sh

# Cho phép user hiện tại dùng Docker (không cần sudo)
sudo usermod -aG docker $USER

# Đăng xuất rồi đăng nhập lại để có hiệu lực
exit
# SSH lại vào VPS

# Kiểm tra Docker đã cài thành công
docker --version
docker compose version
```

Cài **Node.js 24 LTS và npm** trên máy chủ để chạy deployment gate. Gate chỉ dùng module có sẵn của Node; Docker build tự cài dependency từ root lockfile.

## Bước 2: Tải mã nguồn

```bash
# Tải ZaloCRM từ GitHub
git clone https://github.com/duynghien/ZaloCRM.git

# Vào thư mục dự án
cd ZaloCRM
```

## Bước 3: Cấu hình

```bash
# Tạo file cấu hình từ mẫu
cp .env.example .env
```

Mở file `.env` để sửa:

```bash
nano .env
```

Sửa các giá trị sau:

```
# Mật khẩu database — đặt bất kỳ (nhớ giữ bí mật)
DB_PASSWORD=matkhau_cua_ban_o_day

# Secret keys — chạy 2 lệnh bên dưới để tạo giá trị ngẫu nhiên
JWT_SECRET=     # Dán kết quả lệnh: openssl rand -hex 32
ENCRYPTION_KEY= # Dán kết quả lệnh: openssl rand -hex 32

# URL công khai (nếu có domain)
APP_URL=https://ten-domain-cua-ban.com
```

**Tạo secret keys:**

```bash
# Chạy lệnh này, copy kết quả dán vào JWT_SECRET
openssl rand -hex 32

# Chạy lệnh này, copy kết quả dán vào ENCRYPTION_KEY
openssl rand -hex 32
```

Lưu file: nhấn `Ctrl + X`, chọn `Y`, nhấn `Enter`.

## Bước 4: Khởi chạy

```bash
# Build và khởi chạy (lần đầu mất 2-5 phút)
npm run docker:up
```

Lệnh build image, dừng app cũ và xác nhận exit code 0, chạy một migrator mới, rồi khởi chạy app khi migration thành công. Nếu drain hoặc migration lỗi, dừng triển khai để kiểm tra log; không bỏ qua gate bằng lệnh khởi chạy app riêng.

**Kiểm tra hoạt động:**

```bash
# Xem trạng thái các container
docker compose ps

# Kết quả mong đợi: app healthy, db healthy, backup Up
# migrator đã hoàn tất với exit code 0 (xem thêm: docker compose ps -a)
```

## Bước 5: Truy cập lần đầu

1. Thiết lập HTTPS theo phần **Reverse Proxy** bên dưới, rồi mở URL trong `APP_URL`.
   - Ví dụ: `https://crm.your-domain.com`; cổng backend `3080` chỉ bind loopback.

2. Lần đầu sẽ hiện trang **Thiết lập ban đầu**:
   - Tên tổ chức: tên công ty/phòng khám
   - Họ tên: tên admin
   - Email: email đăng nhập
   - Mật khẩu: mật khẩu đăng nhập

3. Nhấn **Tạo tài khoản** → tự động đăng nhập

## Bước 6: Kết nối Zalo đầu tiên

1. Vào menu **Tài khoản Zalo** (bên trái)
2. Nhấn **Thêm Zalo** → đặt tên (VD: "Zalo Sale Hương")
3. Nhấn biểu tượng **QR** → mã QR hiện ra
4. **Mở Zalo trên điện thoại** → Quét mã QR
5. Xác nhận trên điện thoại → Trạng thái chuyển thành **Đã kết nối** (xanh lá)

🎉 **Hoàn tất!** Bắt đầu nhận tin nhắn real-time.

---

## Bảo mật & Thiết lập Reverse Proxy (Nginx / Cloudflare Tunnel)

Để đảm bảo an toàn, ứng dụng chỉ lắng nghe kết nối nội bộ tại `127.0.0.1:3080` (tránh lộ cổng trực tiếp ra mạng công cộng). Bạn nên sử dụng **Nginx** hoặc **Cloudflare Tunnel** để cấp chứng chỉ HTTPS (SSL/TLS):

### Cách 1: Sử dụng Nginx + Let's Encrypt (Khuyên dùng)

1. Cài đặt Nginx và Certbot:
```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx -y
```

2. Đưa cấu hình Nginx mẫu vào hệ thống:
```bash
sudo cp docker/nginx.conf /etc/nginx/sites-available/zalocrm.conf
sudo ln -s /etc/nginx/sites-available/zalocrm.conf /etc/nginx/sites-enabled/
```

3. Mở file và thay `your-domain.com` thành domain của bạn:
```bash
sudo nano /etc/nginx/sites-available/zalocrm.conf
```

4. Cấp chứng chỉ SSL miễn phí Let's Encrypt:
```bash
sudo certbot --nginx -d your-domain.com
sudo systemctl reload nginx
```

### Cách 2: Dùng Cloudflare Tunnel (Đơn giản nhất cho máy cá nhân)

```bash
# Cài cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/

# Đăng nhập Cloudflare
cloudflared tunnel login

# Tạo tunnel
cloudflared tunnel create zalocrm

# Cấu hình ingress
cat > ~/.cloudflared/config.yml << EOF
tunnel: YOUR_TUNNEL_ID
credentials-file: ~/.cloudflared/YOUR_TUNNEL_ID.json
ingress:
  - hostname: crm.your-domain.com
    service: http://127.0.0.1:3080
  - service: http_status:404
EOF

# Thêm DNS
cloudflared tunnel route dns YOUR_TUNNEL_ID crm.your-domain.com

# Chạy tunnel dưới dạng service
sudo cloudflared service install
```

---

## Cập nhật phiên bản mới

```bash
cd ZaloCRM

# Tải phiên bản mới
git pull

# Build và khởi chạy lại
npm run docker:up
```

Dữ liệu không bị mất — database lưu trong Docker volume.

---

## Sao lưu dữ liệu

Hệ thống **tự động sao lưu** hàng ngày vào thư mục `backups/`:
- Giữ 7 bản sao lưu hàng ngày
- Giữ 4 bản sao lưu hàng tuần
- Giữ 3 bản sao lưu hàng tháng

**Sao lưu thủ công:**

```bash
# Tạo bản sao lưu ngay
docker compose exec -T db pg_dump -U crmuser zalocrm > backup-manual.sql
```

**Khôi phục từ bản sao lưu:**

```bash
# Khôi phục database
docker compose exec -T db psql -U crmuser zalocrm < backup-manual.sql
```

---

## Xử lý sự cố

### Container không chạy được

```bash
# Xem log lỗi
docker compose logs app

# Xem cả migration trước khi khắc phục nguyên nhân và triển khai lại
docker compose logs migrator
npm run docker:up
```

### Không truy cập được web

- Kiểm tra domain, HTTPS và reverse proxy tới `127.0.0.1:3080`; firewall chỉ cần mở cổng web 80/443
- Kiểm tra container: `docker compose ps`
- Kiểm tra log: `docker compose logs app`

### Zalo bị mất kết nối

- Hệ thống tự kết nối lại trong 30 giây
- Nếu vẫn không được → vào **Tài khoản Zalo** → quét QR lại
- **Lưu ý:** KHÔNG mở Zalo Web trên trình duyệt

### Quên mật khẩu admin

```bash
# Truy cập database trực tiếp
docker compose exec db psql -U crmuser zalocrm

# Xem email admin
SELECT email, role FROM users WHERE role = 'owner';

# Thoát psql
\q
```

Liên hệ developer để reset mật khẩu qua database.


## Development và kiểm tra container

```bash
npm run docker:dev
```

Mở **http://localhost:5173** để dùng Vite; backend publish tại **http://localhost:3080**. Vite proxy API và Socket.IO tới backend. Compose đặt `APP_URL` của backend từ `DEV_APP_URL` (mặc định `http://localhost:5173`), độc lập với production. Nếu trình duyệt dùng origin khác, đặt `DEV_APP_URL` khớp origin đó; giữ kiểm tra Origin/CSRF.

```bash
npm ci
npm exec --workspace=frontend -- playwright install chromium
npm run verify:production-container
npm run verify:development-compose
```

Smoke dùng project, database và cấu hình giả lập riêng; tự dọn container/volume khi kết thúc. Cần các cổng trống: production `13080`, `15433`; development `13081`, `15173`, `15434`. Nếu trùng cổng hoặc đã có tài nguyên fixture, script báo lỗi để kiểm tra chủ sở hữu, không dừng stack đang chạy. Xem [deployment guide](./docs/deployment-guide.md) để xử lý migration và drain thất bại.
