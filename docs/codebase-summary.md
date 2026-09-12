# ZaloCRM — Codebase Summary & Module Inventory

## 1. Directory Structure

```
ZaloCRM/
├── .env.example              # Mẫu biến môi trường hệ thống
├── docker-compose.yml        # Cấu hình Docker Compose Production (app, migrator, db, backup)
├── docker-compose.dev.yml    # Cấu hình Docker Compose Development (app, frontend Vite, migrator, db)
├── HUONG-DAN-CAI-DAT.md      # Hướng dẫn cài đặt nhanh VPS
├── HUONG-DAN-SU-DUNG.md      # Hướng dẫn sử dụng tính năng
├── README.md                 # Giới thiệu dự án & lệnh điều phối
├── package.json              # Monorepo root workspace configuration
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
│   ├── Dockerfile            # Multi-stage Dockerfile (dependencies, migrator, runtime)
│   ├── Dockerfile.dev        # Dockerfile cho Development
│   └── nginx.conf            # Cấu hình mẫu Nginx Reverse Proxy & SSL
│
├── scripts/                  # Scripts vận hành & CI/CD deployment gates
│   ├── deploy-compose.mjs                # Deployment gate: drain check, image pin, migrator, healthy app
│   ├── audit-production-policy.mjs      # Production dependency audit policy evaluator
│   ├── audit-production-allowlist.json  # Allowlist waivers cho Prisma CLI upstream advisories
│   ├── verify-production-container.mjs  # Container smoke: inventory, offline CLI, dump/restore, drain
│   └── verify-development-compose.mjs   # Dev smoke: browser auth, Vite HMR, backend watch, origin check
│
├── backend/                  # Backend REST API + WebSocket Server (Fastify 5)
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma.config.ts      # Cấu hình Prisma CLI
│   ├── prisma/
│   │   ├── schema.prisma     # Định nghĩa 22 PostgreSQL Data Models
│   │   ├── seed.ts           # Dữ liệu mẫu khởi tạo (Admin account)
│   │   └── migrations/       # Chuỗi Prisma migrations đã kiểm chứng
│   ├── scripts/              # Preflight & build scripts
│   │   ├── build-schema-manifest.mjs          # Sinh required-migrations.json lúc build
│   │   ├── order-code-preflight.ts            # Kiểm tra trùng mã đơn hàng trước migration
│   │   └── report-target-migration-preflight.ts# Kiểm tra dữ liệu AI target legacy
│   └── src/
│       ├── app.ts            # Entrypoint production lifecycle (workers, cron, listeners, shutdown)
│       ├── app-factory.ts    # Factory khởi tạo Fastify app, plugins, routes, socket server
│       ├── config/           # Load & validate biến môi trường
│       ├── modules/          # Các phân hệ nghiệp vụ độc lập
│       │   ├── auth/         # Login, Session refresh rotation, Org, Team, User RBAC
│       │   ├── zalo/         # Zalo Account Pool, QR Login, ACL access, Friend sync, Rate limit
│       │   ├── chat/         # Conversation, Message ingestion, Deduplication, Undo, Attachments
│       │   ├── contacts/     # Contact CRM, Pipeline, Appointment & Reminder
│       │   ├── orders/       # Order management, Atomic sequential code generator (ORD-YYYYMMDD-NNN)
│       │   ├── ai-reports/   # Hierarchical Map-Reduce, Budget manager, Job worker, Resend ledger
│       │   ├── attachments/  # Stream download, Text/Excel/PDF parsing, Resource bounds
│       │   ├── dashboard/    # Analytics KPI, Message volume, Pipeline charts, Excel export
│       │   ├── notifications/# Quản lý thông báo hệ thống
│       │   ├── search/       # Global multi-entity full-text search
│       │   └── api/          # Public REST API (X-API-Key) & Webhook subscriptions
│       └── shared/           # Thư viện dùng chung
│           ├── database/     # Prisma client, Schema compatibility checker
│           ├── realtime/     # Socket server, Authorization, Invalidation & Event delivery queue
│           ├── http/         # Request bounds, Strict schemas, Custom validation errors
│           ├── security/     # Outbound URL policy (SSRF IPv4/IPv6 private IP filter)
│           ├── settings/     # AES-256-GCM encrypted setting codec
│           └── utils/        # Crypto helpers, Logger
│
└── frontend/                 # Frontend Single Page Application (Vue 3 + Vuetify 4)
    ├── package.json
    ├── vite.config.ts
    └── src/
        ├── App.vue           # Root Vue Component
        ├── main.ts           # Entrypoint Vue app
        ├── api/              # Axios HTTP client, Session state in-memory, AI Report API
        ├── composables/      # Vue composables (useChat, useChatRecovery, useZaloAccounts,...)
        ├── components/       # Reusable components (Chat, Contacts, Dashboard, Orders, Settings)
        ├── layouts/          # DefaultLayout, AuthLayout
        ├── plugins/          # Vuetify 4, Pinia, Socket.IO
        ├── router/           # Vue Router navigation guards
        ├── stores/           # Pinia Stores (auth)
        └── views/            # 13 View components chính
```

---

## 2. Phân Hệ Backend (Backend Modules)

| Phân hệ (Module) | Mô tả chi tiết | Các file chính |
|------------------|----------------|----------------|
| **auth** | Đăng nhập, băm mật khẩu `bcryptjs` (cost 12), JWT ngắn hạn trong RAM, Refresh Token xoay vòng qua model `AuthSession` trong DB, bảo vệ CSRF kép, quản lý User, Team, Organization. | `auth-routes.ts`, `auth-service.ts`, `user-routes.ts`, `team-routes.ts`, `org-routes.ts`, `auth-middleware.ts`, `role-middleware.ts` |
| **zalo** | Đăng nhập QR Code, mã hóa session `AES-256-GCM`, quản lý `ZaloPool` (zca-js 2.x), phân quyền truy cập `ZaloAccountAccess` (read, chat, admin), đồng bộ danh bạ bạn bè, rate limiter và health check. | `zalo-routes.ts`, `zalo-pool.ts`, `zalo-socket.ts`, `zalo-access-routes.ts`, `zalo-sync-routes.ts`, `zalo-listener-factory.ts`, `zalo-health-check.ts` |
| **chat** | Quản lý hội thoại, gửi/nhận tin nhắn đa phương tiện, lọc tin nhắn chưa đọc/chưa trả lời, xử lý deduplication tin nhắn đến và thu hồi (undo) an toàn theo thread. | `chat-routes.ts`, `message-handler.ts` |
| **contacts** | Danh bạ khách hàng, phân loại Pipeline 5 trạng thái (`new` → `lost`), lịch hẹn tư vấn và tiến trình tự động nhắc hẹn qua Socket/Zalo. | `contact-routes.ts`, `contact-sub-resource-routes.ts`, `appointment-routes.ts`, `appointment-reminder.ts` |
| **orders** | Quản lý đơn hàng bán hàng gắn với contact/conversation, cấp mã đơn hàng tuần tự nguyên tử `ORD-YYYYMMDD-NNN` chống race condition bằng `order_code_counters`. | `order-routes.ts`, `order-code-service.ts` |
| **ai-reports** | Động cơ AI Digest 2 tầng (Hierarchical Map-Reduce) dùng Gemini model (`GEMINI_MODEL`, mặc định `gemini-3.6-flash`), quản lý ngân sách token/tin nhắn dưới lease fence, snapshot nguồn `(org, account, thread, conversation)`, idempotency resend ledger. | `ai-report-routes.ts`, `report-job-service.ts`, `report-job-worker.ts`, `report-job-budget.ts`, `report-resend-service.ts`, `report-target-service.ts`, `summarizer-service.ts`, `zalo-report-sender.ts`, `email-service.ts`, `report-cron.ts`, `report-admission.ts` |
| **attachments** | Tải stream có giới hạn dung lượng byte, kiểm tra SSRF cho URL, trích xuất văn bản từ PDF, bảng tính Excel đa sheet. | `attachment-downloader.ts`, `attachment-parser.ts`, `attachment-parser-worker.ts` |
| **dashboard** | Thống kê tin nhắn theo ngày, KPI nhân viên bán hàng, biểu đồ tăng trưởng đường ống và nguồn khách, xuất báo cáo tổng hợp ra file Excel. | `dashboard-routes.ts`, `report-routes.ts`, `excel-sheet-builders.ts` |
| **api** | Cung cấp Public REST API xác thực bằng `X-API-Key` và hệ thống Webhook kích hoạt sự kiện bên ngoài với chữ ký HMAC SHA-256. | `public-api-routes.ts`, `public-api-schemas.ts`, `webhook-settings-routes.ts`, `webhook-service.ts` |
| **notifications** | Hệ thống thông báo in-app cho người dùng trong tổ chức. | `notification-routes.ts` |
| **search** | Tìm kiếm toàn văn (Full-text search) đồng thời trên Khách hàng, Tin nhắn hội thoại và Lịch hẹn. | `search-routes.ts` |

---

## 3. Phân Hệ Frontend (Frontend Modules)

- **Views chính:**
  - `LoginView.vue` / `SetupView.vue`: Đăng nhập hệ thống và màn hình khởi tạo tài khoản Owner đầu tiên.
  - `ChatView.vue`: Giao diện Live Chat real-time đa cửa sổ, quản lý hội thoại, gửi tin, đính kèm file, bảng thông tin liên hệ/lịch hẹn/đơn hàng.
  - `ContactsView.vue`: Danh bạ khách hàng dạng bảng và Kanban Pipeline 5 giai đoạn, bộ lọc nguồn, nhân viên và thẻ.
  - `ZaloAccountsView.vue`: Quản lý danh sách tài khoản Zalo, trạng thái live, modal quét mã QR đăng nhập và phân quyền truy cập.
  - `AppointmentsView.vue`: Quản lý danh sách & lịch hẹn hôm nay/sắp tới.
  - `OrdersView.vue`: Quản lý đơn hàng, bộ lọc trạng thái, tổng doanh thu và thống kê theo nhân viên.
  - `ReportsView.vue`: Báo cáo hiệu suất tin nhắn, khách hàng, lịch hẹn và xuất file Excel.
  - `AiReportsView.vue`: Báo cáo điều hành AI Digest (Tạo tức thì, Lịch sử báo cáo, Chi tiết Markdown, Cấu hình nhóm theo dõi, Cấu hình Cron/Zalo/SMTP, Resend).
  - `DashboardView.vue`: Bảng điều khiển KPI tổng quan, biểu đồ khối lượng tin nhắn, nguồn khách và đường ống.
  - `SettingsView.vue`: Cấu hình Tổ chức, Đội nhóm (Teams) và Phân quyền người dùng (Users).
  - `ApiSettingsView.vue`: Cấu hình Webhook & Quản lý API Key tích hợp bên ngoài.
  - `NotFoundView.vue`: Trang 404.

- **Composables & State Helpers:**
  - `session.ts`: Quản lý access token ngắn hạn hoàn toàn trong RAM, đọc CSRF cookie, lắng nghe sự kiện đổi token.
  - `use-chat.ts` & `use-chat-recovery.ts`: Quản lý danh sách hội thoại, tin nhắn, gộp fetch và phục hồi sau mất kết nối hoặc nhận tín hiệu `realtime:resync-required`.
  - `use-zalo-accounts.ts` & `zalo-qr-subscription.ts`: Quản lý polling/socket QR subscription với server ack intent.
  - `ai-report-view-helpers.ts` & `ai-report-api.ts`: Chuẩn hóa dữ liệu hiển thị trạng thái job, target resolution, resend dispatch ledger.

---

## 4. Danh Mục API Endpoints Chi Tiết (60+ Endpoints)

### 4.1. Hệ Thống & Sẵn Sàng (System & Readiness)
```
GET    /health                                # Kiểm tra kết nối DB và tính tương thích schema migrations
GET    /api/v1/status                         # Thông tin phiên bản API banner
```

### 4.2. Khởi Tạo & Xác Thực (Setup & Authentication)
```
GET    /api/v1/setup/status                   # Kiểm tra hệ thống đã có tài khoản Owner chưa
POST   /api/v1/setup                          # Khởi tạo tổ chức và tài khoản Owner đầu tiên
POST   /api/v1/auth/login                     # Đăng nhập hệ thống (cấp JWT trong RAM + Refresh Cookie)
POST   /api/v1/auth/refresh                   # Xoay vòng Refresh Token lấy Access Token mới
POST   /api/v1/auth/logout                    # Đăng xuất phiên hiện tại và thu hồi token
POST   /api/v1/auth/logout-all                # Đăng xuất tất cả các phiên của người dùng
POST   /api/v1/auth/password                  # Đổi mật khẩu cá nhân (tự phục vụ)
GET    /api/v1/profile                        # Lấy thông tin tài khoản người dùng đang đăng nhập
```

### 4.3. Quản Lý Tài Khoản Zalo & Phân Quyền Truy Cập (Zalo Accounts & ACL)
```
GET    /api/v1/zalo-accounts                  # Lấy danh sách tài khoản Zalo kèm trạng thái live
POST   /api/v1/zalo-accounts                  # Tạo bản ghi tài khoản Zalo mới (Owner/Admin)
POST   /api/v1/zalo-accounts/:id/login        # Kích hoạt quét mã QR đăng nhập
POST   /api/v1/zalo-accounts/:id/reconnect    # Kết nối lại bằng phiên đã lưu mã hóa
DELETE /api/v1/zalo-accounts/:id              # Ngắt kết nối và xóa tài khoản Zalo (Owner/Admin)
GET    /api/v1/zalo-accounts/:id/status       # Lấy trạng thái kết nối trực tiếp từ pool
GET    /api/v1/zalo-accounts/:id/access       # Xem danh sách quyền truy cập của tài khoản (Owner/Admin)
POST   /api/v1/zalo-accounts/:id/access       # Cấp quyền truy cập (read/chat/admin) cho user (Owner/Admin)
DELETE /api/v1/zalo-accounts/:id/access/:userId # Thu hồi quyền truy cập Zalo của user (Owner/Admin)
POST   /api/v1/zalo-accounts/:id/sync-contacts# Đồng bộ bạn bè từ Zalo vào danh bạ CRM (Owner/Admin)
```

### 4.4. Trò Chuyện & Tin Nhắn (Conversations & Messages)
```
GET    /api/v1/conversations                  # Lấy danh sách cuộc trò chuyện theo tài khoản Zalo
GET    /api/v1/conversations/:id              # Chi tiết cuộc trò chuyện (yêu cầu quyền read)
GET    /api/v1/conversations/:id/messages     # Lấy lịch sử tin nhắn của cuộc trò chuyện (quyền read)
POST   /api/v1/conversations/:id/messages     # Gửi tin nhắn văn bản/file tới cuộc trò chuyện (quyền chat)
POST   /api/v1/conversations/:id/mark-read    # Đánh dấu cuộc trò chuyện đã đọc (quyền read)
```

### 4.5. Khách Hàng (Contacts & Pipeline)
```
GET    /api/v1/contacts                       # Danh sách khách hàng (hỗ trợ phân trang, tìm kiếm, lọc)
GET    /api/v1/contacts/pipeline              # Thống kê danh sách khách hàng gom nhóm theo 5 giai đoạn
GET    /api/v1/contacts/:id                   # Chi tiết khách hàng
POST   /api/v1/contacts                       # Tạo khách hàng mới
PUT    /api/v1/contacts/:id                   # Cập nhật thông tin khách hàng
PUT    /api/v1/contacts/:id/tags              # Cập nhật danh sách thẻ của khách hàng
DELETE /api/v1/contacts/:id                   # Xóa khách hàng
GET    /api/v1/contacts/:id/appointments      # Lấy danh sách lịch hẹn của khách hàng
GET    /api/v1/contacts/:id/orders            # Lấy danh sách đơn hàng của khách hàng
```

### 4.6. Lịch Hẹn & Nhắc Hẹn (Appointments)
```
GET    /api/v1/appointments/today             # Lấy danh sách lịch hẹn trong ngày hôm nay
GET    /api/v1/appointments/upcoming          # Lấy danh sách lịch hẹn sắp tới (7 ngày)
GET    /api/v1/appointments                  # Lấy danh sách lịch hẹn tổng quát
GET    /api/v1/appointments/:id              # Chi tiết lịch hẹn
POST   /api/v1/appointments                  # Tạo lịch hẹn mới
PUT    /api/v1/appointments/:id              # Cập nhật lịch hẹn
DELETE /api/v1/appointments/:id              # Xóa lịch hẹn
```

### 4.7. Đơn Hàng (Orders)
```
GET    /api/v1/orders                         # Danh sách đơn hàng (lọc theo contact, trạng thái, ngày)
POST   /api/v1/orders                         # Tạo đơn hàng mới (tự sinh mã nguyên tử ORD-YYYYMMDD-NNN)
PUT    /api/v1/orders/:id                     # Cập nhật trạng thái / thông tin đơn hàng
DELETE /api/v1/orders/:id                     # Xóa đơn hàng
GET    /api/v1/orders/stats                   # Thống kê doanh thu, số lượng đơn theo trạng thái
GET    /api/v1/orders/by-staff                # Thống kê doanh thu và đơn hàng theo từng nhân viên
```

### 4.8. Báo Cáo Thống Kê & Bảng Điều Khiển (Dashboard & Reports)
```
GET    /api/v1/dashboard/kpi                  # Các chỉ số KPI tổng hợp (tin nhắn, khách, đơn, doanh thu)
GET    /api/v1/dashboard/message-volume       # Thống kê khối lượng tin nhắn theo ngày
GET    /api/v1/dashboard/pipeline             # Tỷ lệ chuyển đổi khách hàng theo từng giai đoạn
GET    /api/v1/dashboard/sources              # Thống kê khách hàng theo nguồn tiếp cận
GET    /api/v1/dashboard/appointments         # Thống kê trạng thái các cuộc hẹn
GET    /api/v1/reports/messages               # Báo cáo chi tiết tin nhắn theo nhân viên/tài khoản
GET    /api/v1/reports/contacts               # Báo cáo tăng trưởng khách hàng
GET    /api/v1/reports/appointments           # Báo cáo tỷ lệ hoàn thành lịch hẹn
GET    /api/v1/reports/export                 # Xuất file Excel đa sheet tổng hợp số liệu
```

### 4.9. Quản Trị Tổ Chức, Đội Nhóm & Người Dùng (Admin & RBAC)
```
GET    /api/v1/organization                   # Thông tin tổ chức hiện tại
PUT    /api/v1/organization                   # Cập nhật tên tổ chức (Owner)
GET    /api/v1/teams                          # Danh sách đội nhóm trong tổ chức
POST   /api/v1/teams                          # Tạo đội nhóm mới (Owner/Admin)
PUT    /api/v1/teams/:id                      # Cập nhật tên đội nhóm (Owner/Admin)
DELETE /api/v1/teams/:id                      # Xóa đội nhóm (Owner/Admin)
GET    /api/v1/users                          # Danh sách người dùng trong tổ chức
POST   /api/v1/users                          # Tạo người dùng mới (Owner/Admin)
PUT    /api/v1/users/:id                      # Cập nhật thông tin/vai trò người dùng
PUT    /api/v1/users/:id/password             # Đặt lại mật khẩu người dùng (Owner/Admin)
DELETE /api/v1/users/:id                      # Vô hiệu hóa người dùng (Owner)
```

### 4.10. Cấu Hình Tích Hợp Webhook & API Key (Settings)
```
GET    /api/v1/settings/webhook               # Lấy cấu hình Webhook URL và Secret đã mask (Owner/Admin)
PUT    /api/v1/settings/webhook               # Lưu cấu hình Webhook URL và Secret (Owner/Admin)
POST   /api/v1/settings/webhook/test          # Gửi thử nghiệm sự kiện Webhook (Owner/Admin)
GET    /api/v1/settings/api-key               # Xem Public API Key của tổ chức (Owner/Admin, no-store)
POST   /api/v1/settings/api-key/generate      # Tạo mới/thu hồi và cấp lại API Key (Owner/Admin)
DELETE /api/v1/settings/api-key               # Xóa API Key (Owner/Admin)
```

### 4.11. Báo Cáo Điều Hành AI Digest (AI Reports v2)
```
GET    /api/v1/ai-reports/groups              # Danh sách nhóm Zalo và cấu hình theo dõi của user
GET    /api/v1/ai-reports/configs             # Cấu hình chi tiết các nhóm Zalo
PUT    /api/v1/ai-reports/configs/:groupThreadId # Cập nhật cấu hình nhóm (yêu cầu zalo_account_id)
POST   /api/v1/ai-reports/generate            # Khởi tạo tiến trình tạo báo cáo AI On-Demand (Job v2)
GET    /api/v1/ai-reports/jobs/:id            # Theo dõi trạng thái tiến trình Job (queued/running/completed/failed)
POST   /api/v1/ai-reports/jobs/:id/cancel     # Hủy yêu cầu tạo báo cáo đang xử lý
GET    /api/v1/ai-reports                     # Danh sách lịch sử các báo cáo đã tạo
GET    /api/v1/ai-reports/:id                 # Xem chi tiết nội dung báo cáo Markdown & JSON
POST   /api/v1/ai-reports/:id/resend          # Gửi lại báo cáo qua Zalo hoặc Email (Idempotency-Key)
GET    /api/v1/ai-reports/settings            # Xem cấu hình tự động Cron, Zalo nhận và SMTP (Owner/Admin)
PUT    /api/v1/ai-reports/settings            # Cập nhật cấu hình tự động Cron, Zalo nhận và SMTP (Owner/Admin)
```

### 4.12. Thông Báo & Tìm Kiếm Toàn Hệ Thống
```
GET    /api/v1/notifications                  # Danh sách thông báo hệ thống của người dùng
GET    /api/v1/search                         # Tìm kiếm toàn văn trên Contacts, Messages, Appointments
```

### 4.13. Public REST API (Xác thực qua Header X-API-Key)
```
GET    /api/public/contacts                   # Danh sách khách hàng
GET    /api/public/contacts/:id               # Chi tiết khách hàng
POST   /api/public/contacts                   # Tạo khách hàng mới
PUT    /api/public/contacts/:id               # Cập nhật khách hàng
GET    /api/public/conversations              # Danh sách cuộc trò chuyện
GET    /api/public/conversations/:id/messages # Danh sách tin nhắn trong cuộc trò chuyện
GET    /api/public/appointments               # Danh sách lịch hẹn
POST   /api/public/appointments               # Tạo lịch hẹn mới
POST   /api/public/messages/send              # Gửi tin nhắn Zalo cho khách hàng
```

---

## 5. Quality Baseline & Verification Matrix (Cập Nhật 2026-09-13)

| Chỉ số | Trạng thái thực tế | Ghi chú kiểm chứng |
|---|---|---|
| **TypeScript typecheck** | **PASS (0 errors)** | Cả backend (`tsc --noEmit`) và frontend (`vue-tsc --noEmit`) đạt chuẩn. |
| **Production build** | **PASS** | `npm run build` biên dịch thành công schema manifest, Fastify dist và Vite SPA bundle (605ms). |
| **Clean install workspace** | **PASS** | Root `package-lock.json` duy nhất điều phối toàn bộ dependencies monorepo. |
| **Unit tests** | **PASS (98 tests)** | Backend: 5 files (77 tests: audit policy, outbound URL, report job, request bounds, secure codec); Frontend: 3 files (21 tests: QR subscription, chat recovery, AI report resend). |
| **Integration test suites** | **20 test suites** | Kiểm thử Disposable Postgres: tenant isolation, Socket.IO delivery, message replay/undo, order code counter, AI budget & lifecycle. |
| **Browser E2E specs** | **10 specs** | Playwright: session lifecycle, QR intent, chat recovery, account permissions, target qualification. |
| **Dependency audit policy** | **PASS** | `npm run audit:production` kiểm soát chặt chẽ: chỉ chấp nhận 2 waiver Prisma CLI (`deepmerge-ts` / `GHSA-ggr8-5vv4-36mx`, `mysql2` / `GHSA-3f6p-5ww8-9rcr`). |
| **Số file mã nguồn > 200 dòng** | **23 files** | Được đưa vào danh mục theo dõi tái cấu trúc (refactoring inventory). |

---

## 6. Hợp Đồng Kiến Trúc & Bất Biến Hệ Thống (Architectural Invariants)

- **AI Target Qualification & Budget:**
  - AI generate nhận `group_targets: [{ zalo_account_id, group_thread_id }]`; server đóng băng snapshot `(orgId, zaloAccountId, groupThreadId, conversationId)` trong job schema v2. Selector cũ `group_thread_ids` chỉ được chuẩn hóa khi mỗi thread duy nhất trong org; mơ hồ trả `409`, không trộn hai dạng selector.
  - Zalo delivery yêu cầu `zalo_account_id` sender tường minh; source và sender đều kiểm tra ACL. Resend cần `Idempotency-Key`, lưu attempt và dispatch ledger riêng; cùng key/payload trả kết quả cũ, đổi payload với cùng key trả `409`.
  - `GroupReportConfig` định danh theo org/account/thread, giữ cấu hình legacy `needs_resolution` khi không thể resolve. `GeneratedReport` giữ `sourceTargets`; bản cũ `legacy_unverified` chỉ Owner/Admin cùng org đọc, không resend.
  - `report-job-budget.ts` quản lý reservation dưới lease fence trước từng provider attempt; ngân sách gồm prompt/context mở rộng attachment và mọi lượt map/reduce/final/retry. SQL estimate chỉ preflight.

- **Dữ Liệu Đầu Vào & Độ Tin Cậy Giao Dịch:**
  - `request-schemas.ts`, `request-bounds.ts`, `report-http-validation.ts` kiểm tra kiểu/giới hạn trước side effect. Không coi input sai là omission hoặc âm thầm clamp về mặc định.
  - `order-code-service.ts` cấp `ORD-YYYYMMDD-NNN` bằng counter org/ngày UTC trong cùng transaction tạo đơn; unique `(orgId, orderCode)` bảo vệ ở DB. Migration chặn mã trùng hiện có để đối soát.
  - Ingestion deduplicate theo `(conversationId, zaloMsgId)`; replay không tăng unread hay phát lại tác động downstream. Undo resolve account/thread thành conversation trước khi đổi message.

- **Bảo Mật Phiên & Socket Realtime:**
  - JWT access token lưu trong RAM client (15 phút). Refresh token opaque lưu SHA-256 digest trong DB (`auth_sessions`), xoay vòng khi refresh.
  - Đổi mật khẩu, vai trò hoặc khóa tài khoản vô hiệu hóa toàn bộ session và ngắt kết nối socket ngay lập tức.
  - Hàng đợi sự kiện Socket.IO giới hạn 100 sự kiện/account; tràn hàng đợi phát tín hiệu `realtime:resync-required` để client tái đồng bộ qua REST API.

- **SSRF Outbound Policy:**
  - `outbound-url-policy.ts` chặn toàn bộ dải IP private/loopback/link-local của cả IPv4 và IPv6 sau DNS resolution, giới hạn 3 lần redirect và 25MB response stream.

Ma trận HTTP/PostgreSQL/Socket.IO/browser và container smoke đã có đầy đủ trong source. Trạng thái kiểm chứng local đã hoàn tất (commit `d075642`); bước nghiệm thu cuối cùng cần xác nhận qua hosted CI tại remote repository.
