# ZaloCRM — Quản lý nhiều tài khoản Zalo cá nhân

Hệ thống quản lý tập trung nhiều tài khoản Zalo cá nhân/doanh nghiệp trên 1 giao diện web chuẩn Neo-Brutalism CQA. Chat real-time với thanh chọn tài khoản trực quan (`AccountRail`), đồng bộ tin nhắn 2 chiều từ thiết bị ngoài (`selfListen`), gắn nhãn chi nhánh & màu sắc, đường ống CRM, đặt lịch hẹn, kiểm toán nhóm định kỳ & báo cáo AI đa nhà cung cấp (Gemini, OpenAI, DeepSeek, Local Gateway), phát tin việc cần làm Zalo, REST API & Webhook.

---

## 📚 Hệ Thống Tài Liệu Kỹ Thuật (Documentation)

Mã nguồn dự án được chuẩn hóa hệ thống tài liệu tại thư mục [`./docs/`](./docs/):

- **[Project Overview & PRD](./docs/project-overview-pdr.md)** — Tổng quan dự án, phạm vi tính năng & yêu cầu sản phẩm.
- **[System Architecture](./docs/system-architecture.md)** — Sơ đồ kiến trúc tổng thể, luồng dữ liệu & real-time Socket.IO.
- **[Deployment & Operations Guide](./docs/deployment-guide.md)** — Hướng dẫn triển khai Production Docker, Nginx SSL, Cloudflare, AI Isolation & Backup.
- **[Coding Standards & Guidelines](./docs/code-standards.md)** — Quy chuẩn lập trình TypeScript, Fastify, Vue 3, AI SSRF Defense & Kiểm thử tự động.
- **[Codebase Summary](./docs/codebase-summary.md)** — Tổng hợp cấu trúc thư mục, danh sách API Endpoints & DB Schema.
- **[Design Guidelines](./docs/design-guidelines.md)** — Quy chuẩn thiết kế UI/UX (Neo-Brutalism Design System CQA, Vuetify 4, 12 Account Color Palettes).
- **[Product Roadmap](./docs/project-roadmap.md)** — Lộ trình phát triển tính năng, kiểm thử tự động & tích hợp AI Assistant.

> 📖 **Hướng dẫn dành cho người dùng:** [HUONG-DAN-CAI-DAT.md](HUONG-DAN-CAI-DAT.md) | [HUONG-DAN-SU-DUNG.md](HUONG-DAN-SU-DUNG.md)

---

## ⚡ Cài Đặt & Khởi Chạy Nhanh

```bash
git clone https://github.com/duynghien/ZaloCRM.git
cd ZaloCRM

# Tạo file cấu hình biến môi trường
cp .env.example .env
# Sửa file .env — đặt mật khẩu DB và tạo 2 khóa secret bằng command: openssl rand -hex 32

# Cần Node.js 24/npm trên máy chủ để chạy deployment gate
# Build, dừng app cũ an toàn, migrate rồi khởi chạy app mới
npm run docker:up
```

Thiết lập HTTPS bằng [Nginx hoặc Cloudflare Tunnel](./docs/deployment-guide.md#4-thiết-lập-reverse-proxy--ssltls), rồi truy cập URL đã đặt trong `APP_URL` để tạo tài khoản admin. Backend chỉ publish `127.0.0.1:3080`.

Dùng `npm run docker:up` cho cả lần đầu và cập nhật. Lệnh xác nhận app cũ đã dừng sạch trước migration; lỗi drain hoặc migration sẽ chặn khởi chạy phiên bản mới.

---

## 🛠️ Lệnh Phát Triển Đồng Bộ (Root Commands)

```bash
APP_URL=http://localhost:5173 npm run dev # Khởi chạy đồng thời Backend & Frontend cho lập trình viên
npm run build       # Build biên dịch mã nguồn Backend & Frontend
npm run typecheck   # Kiểm tra lỗi Type toàn bộ mã nguồn
npm test            # Chạy toàn bộ unit test (Frontend 56 tests + Backend 162 tests = 218 tests)
npm run docker:dev  # Backend watch + Vite hot reload
npm run verify:production-container  # Smoke production với database riêng
npm run verify:development-compose   # Smoke trình duyệt + hot reload với database riêng
```

Docker development: mở **http://localhost:5173**; backend ở **http://localhost:3080**. `DEV_APP_URL` mặc định `http://localhost:5173`; nếu dùng origin khác, đặt biến này đúng URL trình duyệt. Xem [hướng dẫn development và smoke](./docs/deployment-guide.md#7-development-và-container-smoke) về proxy, ports và Playwright.

---

## 🧱 Công Nghệ Sử Dụng

| Thành phần | Công nghệ |
|-----------|----------|
| **Backend** | Node.js 24 LTS / Fastify 5 / Prisma 7 / TypeScript |
| **Frontend** | Vue 3 / Vuetify 4 / Chart.js / Pinia |
| **Design System** | Neo-Brutalism CQA (Zero Shadow, 1.5px Mechanical Border, Space Grotesk) |
| **AI Engine** | Multi-Provider (Google Gemini, OpenAI, DeepSeek, Local Gateway via Ollama/vLLM) |
| **Cơ sở dữ liệu** | PostgreSQL 16 |
| **Real-time** | Socket.IO |
| **Zalo Engine** | zca-js 2.x (hỗ trợ `selfListen` đồng bộ 2 chiều) |
| **Triển khai** | Docker Compose / Nginx |

> [!NOTE]
> Docker production và development dùng Node.js 24 LTS. Hệ thống hỗ trợ linh hoạt các nhà cung cấp AI: Google Gemini, OpenAI, DeepSeek hoặc Custom OpenAI-Compatible Local Gateway. Cơ chế bảo vệ SSRF mặc định chặn truy cập vào IP Private/Loopback nội bộ trừ khi `ALLOW_PRIVATE_AI_GATEWAYS=true` được thiết lập.

---

## 🛡️ Giấy Phép (License)

MIT — Miễn phí sử dụng và chỉnh sửa.
