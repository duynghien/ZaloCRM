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
├── .github/workflows/ci.yml  # Root install/typecheck/test/build/audit/Docker gate
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
        ├── plugins/          # Vuetify 4, Pinia, Socket.IO
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
| **chat** | Quản lý danh sách hội thoại, gửi/nhận tin nhắn, tải file đính kèm, cập nhật trạng thái đã đọc/chưa đọc. | `chat-routes.ts`, `message-handler.ts` |
| **contacts** | Quản lý danh bạ khách hàng, phân loại Pipeline trạng thái, lịch hẹn (Appointment) & nhắc nhở, đơn hàng (Order). | `contact-routes.ts`, `appointment-routes.ts`, `appointment-reminder.ts` |
| **attachments** | Tải và lưu trữ vĩnh viễn tệp đính kèm (PDF, Excel, Ảnh), trích xuất văn bản & bảng tính đa phương tiện. | `attachment-downloader.ts`, `attachment-parser.ts` |
| **ai-reports** | Động cơ AI Digest 2 tầng (Hierarchical Map-Reduce) với Gemini model cấu hình được (`GEMINI_MODEL`, mặc định `gemini-3.6-flash`), bộ lọc nhiễu, gửi tin Zalo tự động & Email SMTP, lập lịch Cron. | `summarizer-service.ts`, `ai-client.ts`, `noise-filter.ts`, `zalo-report-sender.ts`, `email-service.ts`, `report-cron.ts`, `ai-report-routes.ts` |
| **dashboard** | Thống kê số lượng tin nhắn, KPI nhân viên, biểu đồ tăng trưởng khách hàng, xuất báo cáo ra Excel. | `dashboard-routes.ts`, `report-routes.ts` |
| **api** | Cung cấp Public REST API xác thực bằng `X-API-Key` và hệ thống Webhook kích hoạt sự kiện bên ngoài. | `public-api-routes.ts`, `webhook-settings-routes.ts` |
| **search** | Tìm kiếm toàn văn (Full-text search) đồng thời trên Khách hàng, Cuộc trò chuyện và Lịch hẹn. | `search-routes.ts` |

---

## 3. Phân Hệ Frontend (Frontend Modules)

- **Views chính:**
  - `LoginView.vue` / `SetupView.vue`: Trang đăng nhập và khởi tạo tài khoản Admin ban đầu.
  - `ChatView.vue`: Giao diện Live Chat real-time đa cửa sổ.
  - `ContactsView.vue`: Quản lý danh bạ và Pipeline dạng Kanban / List.
  - `ZaloAccountsView.vue`: Quản lý danh sách tài khoản Zalo & Quét QR Code.
  - `AppointmentsView.vue`: Quản lý danh sách & lịch biểu hẹn.
  - `OrdersView.vue`: Quản lý đơn hàng bán hàng.
  - `ReportsView.vue`: Thống kê tin nhắn và xuất báo cáo Excel.
  - `AiReportsView.vue`: Báo cáo Điều hành AI Digest (Tạo tức thì, Lịch sử báo cáo Markdown/PDF, Cấu hình Cron/Zalo/SMTP).
  - `SettingsView.vue`: Cấu hình Đội nhóm và Phân quyền người dùng.
  - `ApiSettingsView.vue`: Cấu hình Webhook & Quản lý API Keys.

---

## 4. Danh Mục API Endpoints Chính

```
GET    /health                                # Readiness check; 503 when the database is unavailable
POST   /api/v1/auth/login                     # Đăng nhập hệ thống
POST   /api/v1/zalo-accounts                  # Tạo yêu cầu đăng nhập Zalo mới (QR Code)
GET    /api/v1/conversations                  # Lấy danh sách cuộc trò chuyện
POST   /api/v1/conversations/:id/messages     # Gửi tin nhắn Zalo
GET    /api/v1/ai-reports/groups              # Danh sách nhóm Zalo và cấu hình theo dõi
GET    /api/v1/ai-reports/configs             # Cấu hình báo cáo các nhóm Zalo
PUT    /api/v1/ai-reports/configs/:groupThreadId # Body zalo_account_id bắt buộc, cập nhật nguồn cụ thể
POST   /api/v1/ai-reports/generate            # Kích hoạt tạo báo cáo AI On-Demand
GET    /api/v1/ai-reports                     # Lấy danh sách lịch sử báo cáo đã tạo
GET    /api/v1/ai-reports/:id                 # Xem chi tiết nội dung báo cáo
POST   /api/v1/ai-reports/:id/resend          # Gửi lại báo cáo qua Zalo hoặc Email
GET    /api/v1/ai-reports/settings            # Lấy cấu hình tự động hóa & SMTP
PUT    /api/v1/ai-reports/settings            # Cập nhật cấu hình tự động hóa & SMTP
GET    /api/v1/contacts                       # Lấy danh sách khách hàng
POST   /api/public/contacts                   # Public API: Tạo khách hàng mới (X-API-Key)
POST   /api/public/messages/send              # Public API: Gửi tin nhắn qua Zalo (X-API-Key)
```

---

## 5. Quality Baseline (2026-09-02)

| Chỉ số | Trạng thái kiểm chứng |
|---|---|
| TypeScript typecheck | Pass trên working tree hiện tại |
| Production build | Pass với dependency đã cài sẵn |
| Clean install workspace | Root `npm ci` là dependency graph chuẩn |
| Automated tests | Vitest: policy/secret/job-bound/P1 source-contract tests; Playwright: auth-session browser smoke |
| Fastify route schema | 0 schema cho 92 route declarations |
| CI | GitHub Actions chạy root `npm ci`, typecheck, backend test, build, production audit, Playwright smoke và Docker build |
| File mã nguồn > 200 dòng | 19 file (không tính Prisma schema) |
| Dependency audit | CI chặn critical; residual risk được theo dõi trong release documentation |

Baseline này là ghi nhận lịch sử ngày 02/09, không mô tả working tree mới và không phải tiêu chí chấp nhận production.


## 6. Hợp đồng hiện tại — cập nhật 2026-09-12

- AI generate nhận `group_targets: [{ zalo_account_id, group_thread_id }]`; server đóng băng `(orgId, zaloAccountId, groupThreadId, conversationId)` trong job schema v2. Selector cũ `group_thread_ids` chỉ được chuẩn hóa khi mỗi thread duy nhất trong org; mơ hồ trả `409`, không trộn hai dạng selector.
- Zalo delivery yêu cầu `zalo_account_id` sender tường minh; source và sender đều kiểm tra ACL. Resend cần `Idempotency-Key`, lưu attempt và dispatch ledger riêng; cùng key/payload trả kết quả cũ, đổi payload với cùng key trả `409`.
- `GroupReportConfig` định danh theo org/account/thread, giữ cấu hình legacy `needs_resolution` khi không thể resolve. `GeneratedReport` giữ `sourceTargets`; bản cũ `legacy_unverified` chỉ Owner/Admin cùng org đọc, không resend.
- `report-job-budget.ts` quản lý reservation dưới lease fence trước từng provider attempt; ngân sách gồm prompt/context mở rộng attachment và mọi lượt map/reduce/final/retry. SQL estimate chỉ preflight.
- `request-schemas.ts`, `request-bounds.ts`, `report-http-validation.ts` kiểm tra kiểu/giới hạn trước side effect. Không coi input sai là omission hoặc âm thầm clamp về mặc định.
- `order-code-service.ts` cấp `ORD-YYYYMMDD-NNN` bằng counter org/ngày UTC trong cùng transaction tạo đơn; unique `(orgId, orderCode)` bảo vệ ở DB. Migration chặn mã trùng hiện có để đối soát.
- Ingestion deduplicate theo `(conversationId, zaloMsgId)`; replay không tăng unread hay phát lại tác động downstream. Undo resolve account/thread thành conversation trước khi đổi message.

Ma trận HTTP/PostgreSQL/Socket.IO/browser và container smoke đã có trong source. Trạng thái pass phải đối chiếu report của revision tương ứng trong [kế hoạch remediation](../plans/260902-1756-post-remediation-audit-fixes/plan.md); còn chờ commit cuối, hosted CI và review cuối trước nghiệm thu release.
