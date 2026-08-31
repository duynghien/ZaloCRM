# ZaloCRM — Quản lý nhiều tài khoản Zalo cá nhân

Hệ thống quản lý tập trung nhiều tài khoản Zalo cá nhân trên 1 giao diện web. Chat real-time, quản lý khách hàng, lịch hẹn, báo cáo, API & Webhook.

---

## 📚 Hệ Thống Tài Liệu Kỹ Thuật (Documentation)

Mã nguồn dự án được chuẩn hóa hệ thống tài liệu tại thư mục [`./docs/`](./docs/):

- **[Project Overview & PRD](./docs/project-overview-pdr.md)** — Tổng quan dự án, phạm vi tính năng & yêu cầu sản phẩm.
- **[System Architecture](./docs/system-architecture.md)** — Sơ đồ kiến trúc tổng thể, luồng dữ liệu & real-time Socket.IO.
- **[Deployment & Operations Guide](./docs/deployment-guide.md)** — Hướng dẫn triển khai Production Docker, Nginx SSL, Cloudflare & Backup.
- **[Coding Standards & Guidelines](./docs/code-standards.md)** — Quy chuẩn lập trình TypeScript, Fastify, Vue 3 & Bảo mật.
- **[Codebase Summary](./docs/codebase-summary.md)** — Tổng hợp cấu trúc thư mục, danh sách API Endpoints & DB Schema.
- **[Design Guidelines](./docs/design-guidelines.md)** — Quy chuẩn thiết kế UI/UX (Liquid Silicon Design System, Vuetify 4).
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

# Khởi chạy toàn bộ hệ thống bằng Docker Compose
npm run docker:up
```

Truy cập **http://IP-server:3080** → Tạo tài khoản admin lần đầu.

---

## 🛠️ Lệnh Phát Triển Đồng Bộ (Root Commands)

```bash
npm run dev         # Khởi chạy đồng thời Backend & Frontend cho lập trình viên
npm run build       # Build biên dịch mã nguồn Backend & Frontend
npm run typecheck   # Kiểm tra lỗi Type toàn bộ mã nguồn
npm run docker:dev  # Khởi chạy Docker môi trường Development (Hot Reload)
```

---

## 🧱 Công Nghệ Sử Dụng

| Thành phần | Công nghệ |
|-----------|----------|
| **Backend** | Node.js 20 / Fastify 5 / Prisma 7 / TypeScript |
| **Frontend** | Vue 3 / Vuetify 4 / Chart.js / Pinia |
| **Cơ sở dữ liệu** | PostgreSQL 16 |
| **Real-time** | Socket.IO |
| **Zalo Engine** | zca-js 2.x |
| **Triển khai** | Docker Compose / Nginx |

> [!WARNING]
> Image production hiện vẫn dùng Node.js 20, nhánh đã hết vòng đời hỗ trợ. Trước lần phát hành production tiếp theo, nâng lên Node.js LTS còn được hỗ trợ và xử lý các release blocker trong [Product Roadmap](./docs/project-roadmap.md).

---

## 🛡️ Giấy Phép (License)

MIT — Miễn phí sử dụng và chỉnh sửa.
