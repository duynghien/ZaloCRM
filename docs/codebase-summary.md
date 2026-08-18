# ZaloCRM — Codebase Summary & Module Inventory

## 1. Directory Structure

```
ZaloCRM/
├── .env.example              # Mẫu biến môi trường hệ thống
├── docker-compose.yml        # Cấu hình Docker Compose Production
├── docker-compose.dev.yml    # Cấu hình Docker Compose Development (Hot Reload)
├── HUONG-DAN-CAI-DAT.md      # Hướng dẫn cài đặt nhanh VPS
├── HUONG-DAN-SU-DUNG.md      # Hướng dẫn sử dụng tính năng
├── README.md                 # Giới thiệu dự án
├── package.json              # Script điều phối Workspace Root
│
├── docs/                     # Hệ thống tài liệu kỹ thuật chuẩn
│   ├── project-overview-pdr.md
│   ├── system-architecture.md
│   ├── deployment-guide.md
│   ├── code-standards.md
│   ├── codebase-summary.md
│   ├── design-guidelines.md
│   └── project-roadmap.md
│
├── docker/                   # Tài nguyên đóng gói Docker & Proxy
│   ├── Dockerfile            # Multi-stage Dockerfile cho Production
│   ├── Dockerfile.dev        # Dockerfile cho Development
│   └── nginx.conf            # Cấu hình mẫu Nginx Reverse Proxy & SSL
│
├── backend/                  # Backend REST API + WebSocket Server (Fastify)
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/
│   │   ├── schema.prisma     # Định nghĩa PostgreSQL Data Models
│   │   └── seed.ts           # Dữ liệu mẫu khởi tạo (Admin account)
│   └── src/
│       ├── app.ts            # Entrypoint khởi động Fastify & Socket.IO
│       ├── config/           # Load & validate biến môi trường
│       ├── modules/          # Các phân hệ nghiệp vụ độc lập
│       │   ├── api/          # Public REST API & Webhook Settings
│       │   ├── auth/         # Login, Auth JWT, Org, Team, User RBAC
│       │   ├── chat/         # Quản lý Conversation & Message
│       │   ├── contacts/     # Quản lý Contact, Appointment, Order
│       │   ├── dashboard/    # Analytics, Stats & Report Excel Export
│       │   ├── notifications/# Quản lý Thông báo hệ thống
│       │   ├── search/       # Search Engine toàn hệ thống
│       │   └── zalo/         # Zalo Account Pool, QR Login, Sync
│       └── shared/           # Các thư viện chung (DB, Crypto, Logger)
│
└── frontend/                 # Frontend Single Page Application (Vue 3)
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.vue           # Root Vue Component
        ├── main.ts           # Entrypoint Vue app
        ├── api/              # Axios HTTP client instances
        ├── components/       # UI Components dùng chung (Chat, Calendar,...)
        ├── layouts/          # MainLayout, AuthLayout
        ├── plugins/          # Vuetify 3, Pinia, Socket.IO
        ├── router/           # Vue Router navigation guards
        ├── stores/           # Pinia Stores (auth, zalo, chat, contact,...)
        └── views/            # Các trang giao diện chính
```

---

## 2. Phân Hệ Backend (Backend Modules)

| Phân hệ (Module) | Mô tả chi tiết | Các file chính |
|------------------|----------------|----------------|
| **auth** | Đăng nhập, băm mật khẩu, cấp JWT token, quản lý Tổ chức (Org), Đội nhóm (Team), Người dùng (User). | `auth-routes.ts`, `auth-service.ts`, `user-routes.ts` |
| **zalo** | Đăng nhập QR Code, mã hóa session, quản lý ZaloPool (zca-js), phân quyền tài khoản Zalo, đồng bộ danh bạ. | `zalo-routes.ts`, `zalo-pool.ts`, `zalo-socket.ts` |
| **chat** | Quản lý danh sách hội thoại, gửi/nhận tin nhắn, tải file đính kèm, cập nhật trạng thái đã đọc/chưa đọc. | `chat-routes.ts`, `chat-service.ts` |
| **contacts** | Quản lý danh bạ khách hàng, phân loại Pipeline trạng thái, lịch hẹn (Appointment) & nhắc nhở, đơn hàng (Order). | `contact-routes.ts`, `appointment-routes.ts`, `appointment-reminder.ts` |
| **dashboard** | Thống kê số lượng tin nhắn, KPI nhân viên, biểu đồ tăng trưởng khách hàng, xuất báo cáo ra Excel. | `dashboard-routes.ts`, `report-routes.ts` |
| **api** | Cung cấp Public REST API xác thực bằng `X-API-Key` và hệ thống Webhook kích hoạt sự kiện bên ngoài. | `public-api-routes.ts`, `webhook-settings-routes.ts` |
| **search** | Tìm kiếm toàn văn (Full-text search) đồng thời trên Khách hàng, Cuộc trò chuyện và Lịch hẹn. | `search-routes.ts` |

---

## 3. Phân Hệ Frontend (Frontend Modules)

- **Views chính:**
  - `LoginView.vue` / `InitialSetupView.vue`: Trang đăng nhập và khởi tạo tài khoản Admin ban đầu.
  - `ChatView.vue`: Giao diện Live Chat real-time đa cửa sổ.
  - `ContactsView.vue`: Quản lý danh bạ và Pipeline dạng Kanban / List.
  - `ZaloAccountsView.vue`: Quản lý danh sách tài khoản Zalo & Quét QR Code.
  - `AppointmentsView.vue`: Quản lý danh sách & lịch biểu hẹn.
  - `DashboardView.vue`: Biểu đồ phân tích & Báo cáo thống kê.
  - `SettingsView.vue`: Cấu hình Webhook, API Key, Đội nhóm và Phân quyền.

---

## 4. Danh Mục API Endpoints Chính

```
GET    /health                      # Health check server & DB connection
POST   /api/auth/login              # Đăng nhập hệ thống
POST   /api/zalo/accounts           # Tạo yêu cầu đăng nhập Zalo mới (QR Code)
GET    /api/chat/conversations      # Lấy danh sách cuộc trò chuyện
POST   /api/chat/messages/send      # Gửi tin nhắn Zalo
GET    /api/contacts                # Lấy danh sách khách hàng
POST   /api/public/contacts         # Public API: Tạo khách hàng mới (X-API-Key)
POST   /api/public/messages/send    # Public API: Gửi tin nhắn qua Zalo (X-API-Key)
```
