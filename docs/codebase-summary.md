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
│   │   ├── schema.prisma     # Định nghĩa 24 PostgreSQL Data Models (hỗ trợ branchTag, colorTag, AI usage telemetry)
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
│       │   ├── zalo/         # Zalo Account Pool, QR Login, ACL access, Friend sync, Rate limit 2 tầng, Self-listen
│       │   ├── chat/         # Conversation, Message ingestion, Deduplication, Undo, Outbound Media dispatch
│       │   │   └── copilot/  # Conversational Copilot (Single-Inference Service, Prompt Builder, Resilient Parser, Debouncer, Anomaly Escalator, Cache)
│       │   ├── contacts/     # Contact CRM, Pipeline, Appointment & Reminder, Self-healing contacts
│       │   ├── orders/       # Order management, Atomic sequential code generator (ORD-YYYYMMDD-NNN)
│       │   ├── ai-reports/   # Multi-provider router, Burst sampler, Two-tier audit, Action item broadcast, Cron, Telemetry, Dual-PDF dispatch
│       │   │   ├── providers/               # AI Adapters: Gemini, OpenAI, DeepSeek, Hybrid Vision Bridge
│       │   │   ├── attachment-burst-sampler.ts # Khử trùng URL, prompt injection sanitization, pool 4 worker
│       │   │   ├── attachment-image-loader.ts  # Nạp ảnh đa phương thức, kiểm soát trần 12MB, chống traversal
│       │   │   ├── report-action-item-parser.ts# Trích xuất nhiệm vụ hành động (Section 5 Action Items)
│       │   │   ├── report-brief-service.ts     # Sinh bản tin tóm tắt điều hành & kiểm toán tuân thủ (SSoT telemetry)
│       │   │   ├── report-pdf-service.ts       # Sinh tệp PDF báo cáo điều hành & kiểm toán A4 Neo-Brutalism
│       │   │   ├── zalo-report-sender.ts       # Điều phối gửi báo cáo qua Zalo (Dual-PDF, pacing rate limit, fallback)
│       │   │   ├── ai-provider-settings-service.ts # Quản lý và mã hóa cấu hình đa nhà cung cấp AI
│       │   │   ├── ai-gateway-validator.ts     # Kiểm tra bảo mật URL AI Gateway, phòng chống SSRF
│       │   │   ├── ai-audit-rule-service.ts    # Nghiệp vụ quy tắc giám sát nhóm tự động
│       │   │   ├── ai-audit-prompt-builder.ts  # Xây dựng prompt kiểm toán chống prompt injection (<chat_transcript>)
│       │   │   ├── ai-audit-evaluator-helpers.ts # Parser an toàn, Error Boundary, tính scan window & whitelist nhân sự
│       │   │   ├── ai-audit-evaluator.ts       # Động cơ đánh giá tuân thủ kịch bản nhóm
│       │   │   ├── audit-rule-cron-runner.ts   # Bộ chạy cron theo phút với khóa advisory lock
│       │   │   ├── ai-usage-tracker.ts         # Ghi nhận và tổng hợp token usage, chi phí USD/VND theo thời gian thực
│       │   │   ├── ai-pricing-catalog.ts       # Bảng định giá chi tiết token cho từng model/provider
│       │   │   ├── ai-usage-serializer.ts      # Serializer BigInt an toàn cho API telemetry
│       │   │   └── ai-budget-alert-service.ts  # Cảnh báo hạn mức chi phí AI của tổ chức
│       │   ├── attachments/  # Media Staging, Magic byte sniffing, Ticket-based Streaming, Multi-tenant Isolation, Orphan cleanup cron
│       │   │   ├── attachment-routes.ts        # Multipart upload, staged deletion, HMAC ticket generation, stream download
│       │   │   ├── attachment-validator.ts     # Magic bytes inspection (image-size), metadata validation, sanitization
│       │   │   ├── attachment-ticket-service.ts# Cấp & xác thực vé stream ngắn hạn (60s) bảo vệ URL tải Zalo
│       │   │   ├── attachment-legacy-migration.ts # Đối soát quyền sở hữu JSONB GIN (@>) & di chuyển nguyên tử (.part -> rename)
│       │   │   ├── orphan-cleanup-task.ts      # Cron định kỳ theo giờ tự động xóa tệp staged mồ côi > 2h
│       │   │   ├── attachment-downloader.ts    # Tải stream tệp đính kèm ngoài có giới hạn byte & SSRF filter, phân lập theo orgId
│       │   │   └── attachment-parser.ts        # Trích xuất văn bản từ PDF, Excel đa sheet
│       │   ├── dashboard/    # Analytics KPI, AI Cost KPI, Message volume, Pipeline charts, Excel export (kèm AI sheet)
│       │   │   ├── dashboard-ai-kpi-handler.ts # API tổng hợp chi phí AI hôm nay vs hôm qua
│       │   │   ├── report-ai-usage-handler.ts  # API báo cáo chi tiết sử dụng AI theo ngày, task type, model
│       │   │   └── ai-report-sheet-builder.ts  # Builder trang tính Excel xuất dữ liệu chi phí AI
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
└── frontend/                 # Frontend Single Page Application (Vue 3 + Vuetify 4 + Neo-Brutalism CQA)
    ├── package.json
    ├── vite.config.ts
    ├── public/
    │   └── icons/            # Thư viện Custom SVG Icons & Brand SVG Icons (AI providers, Zalo, CRM)
    └── src/
        ├── App.vue           # Root Vue Component
        ├── main.ts           # Entrypoint Vue app
        ├── api/              # Axios HTTP client, Session state in-memory, AI Report API, AI Usage API
        ├── composables/      # Vue composables (useChat, useChatCopilot, useStagedMedia, useChatRecovery, useZaloAccounts, useDashboard,...)
        ├── components/       # Reusable components
        │   ├── chat/         # AccountRail, ConversationList, MessageThread, StagedMediaBar, MediaLightboxDialog, ChatCopilotBar, ChatAiDraftCard, ChatAnomalyBanner, ChatAppointments, ChatOrders
        │   ├── contacts/     # ContactDetailDialog, ContactFilters
        │   ├── dashboard/    # KpiCards, AiCostKpiCard, DashboardDateFilter, MessageVolumeChart, PipelineChart,...
        │   ├── orders/       # OrderStaffTable
        │   ├── reports/      # AiUsageReportTab, ai-usage-charts, ai-usage-metric-cards
        │   ├── settings/     # OrgSettings, TeamManagement, ZaloAccessDialog
        │   ├── zalo/         # ZaloAccountCard, ZaloAccountEditDialog, zalo-account-add-dialog
        │   ├── ai-reports/   # AiProviderSettingsCard, AiAuditRulesCard, AiAuditRuleDialog
        │   └── navigation/   # NavUserProfile, nav-menu-items
        ├── layouts/          # DefaultLayout, AuthLayout
        ├── plugins/          # Vuetify 4, Pinia, Socket.IO, Custom Icons registry
        ├── router/           # Vue Router navigation guards
        ├── stores/           # Pinia Stores (auth)
        ├── utils/            # account-colors.ts (12 bảng mã màu tài khoản Zalo chuẩn nhận diện), file-utils.ts
        └── views/            # 13 View components chính
```

---

## 2. Phân Hệ Backend (Backend Modules)

| Phân hệ (Module) | Mô tả chi tiết | Các file chính |
|------------------|----------------|----------------|
| **auth** | Đăng nhập, băm mật khẩu `bcryptjs` (cost 12), JWT ngắn hạn đồng bộ với `localStorage` (`zalo_crm_token`) duy trì phiên khi F5 (0ms latency), Refresh Token xoay vòng qua model `AuthSession` trong DB, hỗ trợ `trustProxy: true` và CORS whitelist động cho loopback/upstream, bảo vệ CSRF kép, quản lý User, Team, Organization. | `auth-routes.ts`, `auth-service.ts`, `user-routes.ts`, `team-routes.ts`, `org-routes.ts`, `auth-middleware.ts`, `role-middleware.ts` |
| **zalo** | Đăng nhập QR Code, mã hóa session `AES-256-GCM`, quản lý `ZaloPool` (zca-js 2.x), phân quyền truy cập `ZaloAccountAccess`, gắn thẻ chi nhánh (`branchTag`) và 12 màu nhận diện (`colorTag`), đồng bộ tin nhắn ngoài (`selfListen: true`), rate limiter 2 tầng (hỗ trợ trọng số gửi media x2) và health check. | `zalo-routes.ts`, `zalo-pool.ts`, `zalo-socket.ts`, `zalo-access-routes.ts`, `zalo-sync-routes.ts`, `zalo-listener-factory.ts`, `zalo-health-check.ts`, `zalo-rate-limiter.ts` |
| **chat & copilot** | Quản lý hội thoại, tin nhắn đa phương tiện 2 chiều, khay chờ tệp đính kèm, dán ảnh clipboard, phóng to ảnh lightbox, lọc tin, thu hồi (undo) an toàn, cập nhật ảnh realtime qua `chat:message:attachments-updated`, hiển thị fallback card khi lỗi ảnh; kèm Trợ lý Ảo Bán Hàng (Conversational Copilot: Single-Inference AI Engine với chuỗi failover đa tầng tái sử dụng AiProviderRouter, Smart Turn Debouncer 3.0s, gợi ý phản hồi `Alt+1/2/3`, bóc tách đơn/lịch Human-in-the-Loop, phát hiện bất thường & leo thang quản lý). | `chat-routes.ts`, `message-handler.ts`, `chat-copilot-service.ts`, `chat-turn-debouncer.ts`, `chat-copilot-routes.ts`, `chat-copilot-prompt-builder.ts`, `chat-copilot-parser.ts`, `chat-copilot-anomaly-escalator.ts`, `chat-copilot-cache.ts` |
| **contacts** | Danh bạ khách hàng, phân loại Pipeline 5 trạng thái (`new` → `lost`), tự lành liên kết hội thoại và cập nhật tên Zalo, lịch hẹn tư vấn và tiến trình tự động nhắc hẹn qua Socket/Zalo. | `contact-routes.ts`, `contact-sub-resource-routes.ts`, `appointment-routes.ts`, `appointment-reminder.ts` |
| **orders** | Quản lý đơn hàng bán hàng gắn với contact/conversation, cấp mã đơn hàng tuần tự nguyên tử `ORD-YYYYMMDD-NNN` chống race condition bằng `order_code_counters`. | `order-routes.ts`, `order-code-service.ts` |
| **ai-reports & telemetry** | Động cơ AI Multi-Provider (DeepSeek Primary, Gemini, OpenAI, Local Gateway) với DeepSeek-V4.1-Flash Native Multimodal, chuỗi failover 3 tầng (DeepSeek -> Gemini -> OpenAI), single-layer budget reservation, Multimodal Burst Sampling (pool 4 worker, trần 12MB), Two-Tier Cross-Verification (Tier 1 đối soát văn bản-ảnh, Tier 2 trích xuất & phát sóng Action Items qua Zalo), Quy tắc giám sát nhóm tự động có advisory lock, và Hệ thống đo lường token usage/chi phí USD/VND theo thời gian thực. | `ai-report-routes.ts`, `ai-audit-rule-routes.ts`, `ai-audit-rule-service.ts`, `ai-audit-evaluator.ts`, `audit-rule-cron-runner.ts`, `report-job-service.ts`, `report-job-worker.ts`, `report-job-budget.ts`, `ai-usage-tracker.ts`, `ai-pricing-catalog.ts`, `ai-usage-serializer.ts`, `ai-budget-alert-service.ts`, `attachment-burst-sampler.ts`, `attachment-image-loader.ts`, `report-action-item-parser.ts`, `ai-provider-settings-service.ts`, `ai-gateway-validator.ts`, `summarizer-service.ts`, `zalo-report-sender.ts`, `email-service.ts`, `report-cron.ts` |
| **attachments** | Khay chờ media (staging), tải lên multipart an toàn, phân lập tệp đính kèm theo thư mục tổ chức `attachments/<orgId>/`, đối soát tệp cũ trên đĩa qua toán tử JSONB `@>` có chỉ mục GIN trên `messages.attachments`, di chuyển nguyên tử (.part -> rename) và xóa file gốc dọn đĩa, kiểm tra magic bytes (`image-size`), tạo vé streaming HMAC ngắn hạn (60s) phục vụ Zalo server tải media, cron dọn dẹp tệp mồ côi theo giờ, tải stream có giới hạn byte, kiểm tra SSRF, trích xuất văn bản từ PDF/Excel đa sheet kèm bộ lọc Unicode null byte (Postgres 22P05) đệ quy có chốt chặn an toàn `maxDepth = 20` và try/catch error boundary. | `attachment-routes.ts`, `attachment-validator.ts`, `attachment-ticket-service.ts`, `attachment-legacy-migration.ts`, `orphan-cleanup-task.ts`, `attachment-downloader.ts`, `attachment-parser.ts`, `attachment-processor.ts`, `attachment-parser-worker.ts` |
| **dashboard & reports** | Thống kê tin nhắn theo ngày, KPI nhân viên bán hàng, Thẻ KPI chi phí AI (`AiCostKpiCard`), Tab báo cáo chi tiết sử dụng AI, biểu đồ tăng trưởng đường ống và nguồn khách, bộ lọc thời gian nâng cao, xuất báo cáo tổng hợp ra file Excel (gồm cả sheet chi phí AI). | `dashboard-routes.ts`, `dashboard-ai-kpi-handler.ts`, `report-routes.ts`, `report-ai-usage-handler.ts`, `excel-sheet-builders.ts`, `ai-report-sheet-builder.ts` |
| **api** | Cung cấp Public REST API xác thực bằng `X-API-Key` và hệ thống Webhook kích hoạt sự kiện bên ngoài với chữ ký HMAC SHA-256. | `public-api-routes.ts`, `public-api-schemas.ts`, `webhook-settings-routes.ts`, `webhook-service.ts` |
| **notifications** | Hệ thống thông báo in-app cho người dùng trong tổ chức. | `notification-routes.ts` |
| **search** | Tìm kiếm toàn văn (Full-text search) đồng thời trên Khách hàng, Tin nhắn hội thoại và Lịch hẹn. | `search-routes.ts` |
| **api** | Cung cấp Public REST API xác thực bằng `X-API-Key` và hệ thống Webhook kích hoạt sự kiện bên ngoài với chữ ký HMAC SHA-256. | `public-api-routes.ts`, `public-api-schemas.ts`, `webhook-settings-routes.ts`, `webhook-service.ts` |
| **notifications** | Hệ thống thông báo in-app cho người dùng trong tổ chức. | `notification-routes.ts` |
| **search** | Tìm kiếm toàn văn (Full-text search) đồng thời trên Khách hàng, Tin nhắn hội thoại và Lịch hẹn. | `search-routes.ts` |

---

## 3. Phân Hệ Frontend (Frontend Modules)

- **Views chính:**
  - `LoginView.vue` / `SetupView.vue`: Đăng nhập hệ thống và màn hình khởi tạo tài khoản Owner đầu tiên.
  - `ChatView.vue`: Giao diện Live Chat real-time với thanh trượt đa tài khoản dọc `AccountRail.vue`, quản lý hội thoại, gửi tin, đính kèm file, bảng thông tin liên hệ/lịch hẹn/đơn hàng.
  - `ContactsView.vue`: Danh bạ khách hàng dạng bảng và Kanban Pipeline 5 giai đoạn, bộ lọc nguồn, nhân viên và thẻ.
  - `ZaloAccountsView.vue`: Quản lý danh sách tài khoản Zalo dạng thẻ `ZaloAccountCard.vue`, chỉnh sửa nhãn chi nhánh & mã màu `ZaloAccountEditDialog.vue`, modal quét mã QR đăng nhập và phân quyền truy cập.
  - `AppointmentsView.vue`: Quản lý danh sách & lịch hẹn hôm nay/sắp tới.
  - `OrdersView.vue`: Quản lý đơn hàng, bộ lọc trạng thái, tổng doanh thu và thống kê theo nhân viên.
  - `ReportsView.vue`: Báo cáo hiệu suất tin nhắn, khách hàng, lịch hẹn và xuất file Excel.
  - `AiReportsView.vue`: Báo cáo điều hành AI Digest (Tạo tức thì, Lịch sử báo cáo, Chi tiết Markdown, Quản lý nhiệm vụ Action Items & Broadcast Zalo, Cấu hình đa nhà cung cấp `AiProviderSettingsCard.vue`, Quy tắc giám sát nhóm `AiAuditRulesCard.vue`, `AiAuditRuleDialog.vue`).
  - `DashboardView.vue`: Bảng điều khiển KPI tổng quan với bộ lọc ngày `DashboardDateFilter.vue`, biểu đồ khối lượng tin nhắn, nguồn khách và đường ống.
  - `SettingsView.vue`: Cấu hình Tổ chức, Đội nhóm (Teams) và Phân quyền người dùng (Users).
  - `ApiSettingsView.vue`: Cấu hình Webhook & Quản lý API Key tích hợp bên ngoài.
  - `NotFoundView.vue`: Trang 404.

- **Composables & State Helpers:**
  - `session.ts`: Quản lý access token ngắn hạn hoàn toàn trong RAM, đọc CSRF cookie, lắng nghe sự kiện đổi token.
  - `use-chat.ts` & `use-chat-recovery.ts`: Quản lý danh sách hội thoại, tin nhắn, gộp fetch và phục hồi sau mất kết nối hoặc nhận tín hiệu `realtime:resync-required`.
  - `use-chat-copilot.ts`: Quản lý trạng thái Trợ lý Ảo Bán Hàng (Copilot), lắng nghe socket `chat:copilot_suggestion` & `chat:anomaly_alert`, kích hoạt gợi ý chủ động, chèn Smart Reply và đồng bộ địa chỉ nhận hàng.
  - `use-zalo-accounts.ts` & `zalo-qr-subscription.ts`: Quản lý polling/socket QR subscription với server ack intent.
  - `ai-report-view-helpers.ts` & `ai-report-api.ts`: Chuẩn hóa dữ liệu hiển thị trạng thái job, target resolution, resend dispatch ledger, task status toggle và task broadcast.
  - `account-colors.ts`: Định nghĩa 8 màu chuẩn nhận diện tài khoản Zalo, các token viền, nền sáng/tối và chip styling.
  - `custom-icons.ts`: Đăng ký hệ thống biểu tượng SVG tùy biến tích hợp trực tiếp vào Vuetify 4.

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
POST   /api/v1/zalo-accounts                  # Tạo bản ghi tài khoản Zalo mới (Owner/Admin, hỗ trợ branchTag, colorTag)
PATCH  /api/v1/zalo-accounts/:id              # Cập nhật thông tin tài khoản (displayName, branchTag, colorTag, phone)
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
POST   /api/v1/conversations/:id/messages     # Gửi tin nhắn văn bản/tệp đính kèm tới cuộc trò chuyện (quyền chat, rate limit trọng số x2 cho media)
POST   /api/v1/conversations/:id/mark-read    # Đánh dấu cuộc trò chuyện đã đọc (quyền read)
POST   /api/v1/conversations/:id/copilot/suggest # Kích hoạt suy luận gợi ý Copilot chủ động (On-Demand)
PATCH  /api/v1/conversations/:id/resolve-anomaly # Đánh dấu đã xử lý khiếu nại/bất thường trong hội thoại
```

### 4.4.1. Tệp Đính Kèm, Khay Chờ & Stream Đa Phương Tiện (Attachments & Media Streaming)
```
POST   /api/v1/media/upload                   # Tải lên tệp đa phương tiện/ảnh vào khay chờ staged (tối đa 5 tệp, kiểm tra magic bytes)
DELETE /api/v1/media/upload/:id               # Hủy/xóa tệp đính kèm trong khay chờ staged
POST   /api/v1/attachments/ticket             # Tạo vé stream ngắn hạn (60s HMAC) cho server Zalo tải media
GET    /api/v1/attachments/:filename          # Đọc stream tệp bảo mật (xác thực cookie, ticket, bearer hoặc token)
```

### 4.5. Khách Hàng (Contacts & Pipeline)
```
GET    /api/v1/contacts                       # Danh sách khách hàng (hỗ trợ phân trang, tìm kiếm, lọc)
GET    /api/v1/contacts/pipeline              # Thống kê danh sách khách hàng gom nhóm theo 5 giai đoạn
GET    /api/v1/contacts/:id                   # Chi tiết khách hàng
POST   /api/v1/contacts                       # Tạo khách hàng mới
PUT    /api/v1/contacts/:id                   # Cập nhật thông tin khách hàng
PATCH  /api/v1/contacts/:id                   # Cập nhật một phần (hỗ trợ deep-merge metadata địa chỉ giao hàng)
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
GET    /api/v1/dashboard/ai-kpi               # Thẻ KPI chi phí AI & token usage hôm nay vs hôm qua (Admin/Owner)
GET    /api/v1/dashboard/message-volume       # Thống kê khối lượng tin nhắn theo ngày
GET    /api/v1/dashboard/pipeline             # Tỷ lệ chuyển đổi khách hàng theo từng giai đoạn
GET    /api/v1/dashboard/sources              # Thống kê khách hàng theo nguồn tiếp cận
GET    /api/v1/dashboard/appointments         # Thống kê trạng thái các cuộc hẹn
GET    /api/v1/reports/messages               # Báo cáo chi tiết tin nhắn theo nhân viên/tài khoản
GET    /api/v1/reports/contacts               # Báo cáo tăng trưởng khách hàng
GET    /api/v1/reports/appointments           # Báo cáo tỷ lệ hoàn thành lịch hẹn
GET    /api/v1/reports/ai-usage               # Báo cáo chi tiết sử dụng AI theo ngày, task type, model (Admin/Owner)
GET    /api/v1/reports/export                 # Xuất file Excel đa sheet (messages, contacts, appointments, ai-usage)
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

### 4.11. Báo Cáo Điều Hành AI Digest (AI Reports v2), Multi-Provider & Quy Tắc Giám Sát Nhóm
```
GET    /api/v1/ai-reports/groups              # Danh sách nhóm Zalo và cấu hình theo dõi của user
GET    /api/v1/ai-reports/configs             # Cấu hình chi tiết các nhóm Zalo
PUT    /api/v1/ai-reports/configs/:groupThreadId # Cập nhật cấu hình nhóm (yêu cầu zalo_account_id)
POST   /api/v1/ai-reports/generate            # Khởi tạo tiến trình tạo báo cáo AI On-Demand (Job v2)
GET    /api/v1/ai-reports/jobs/:id            # Theo dõi trạng thái tiến trình Job (queued/running/completed/failed)
POST   /api/v1/ai-reports/jobs/:id/cancel     # Hủy yêu cầu tạo báo cáo đang xử lý
GET    /api/v1/ai-reports                     # Danh sách lịch sử các báo cáo đã tạo (hỗ trợ report_type=audit_rule)
GET    /api/v1/ai-reports/:id                 # Xem chi tiết nội dung báo cáo Markdown & JSON
POST   /api/v1/ai-reports/:id/resend          # Gửi lại báo cáo qua Zalo hoặc Email (Idempotency-Key)
GET    /api/v1/ai-reports/settings            # Xem cấu hình tự động Cron, Zalo nhận và SMTP (Owner/Admin)
PUT    /api/v1/ai-reports/settings            # Cập nhật cấu hình tự động Cron, Zalo nhận và SMTP (Owner/Admin)
POST   /api/v1/ai-reports/settings/test-ai    # Kiểm tra kết nối và phản hồi của AI Provider (Owner/Admin)
POST   /api/v1/ai-reports/settings/models     # Dò tìm động danh sách mô hình AI khả dụng (Owner/Admin)
PUT    /api/v1/ai-reports/:id/tasks/:taskId   # Cập nhật trạng thái hoàn thành nhiệm vụ hành động (done/pending)
POST   /api/v1/ai-reports/:id/broadcast-tasks # Phát sóng các nhiệm vụ hành động ưu tiên cao tới nhóm Zalo
GET    /api/v1/ai-reports/rules               # Danh sách các quy tắc giám sát nhóm Zalo
POST   /api/v1/ai-reports/rules               # Tạo quy tắc giám sát mới (Owner/Admin)
PUT    /api/v1/ai-reports/rules/:id           # Cập nhật quy tắc giám sát (Owner/Admin)
DELETE /api/v1/ai-reports/rules/:id           # Xóa quy tắc giám sát (Owner/Admin)
POST   /api/v1/ai-reports/rules/:id/run-now   # Kích hoạt đánh giá tức thì (Run Now, Owner/Admin)
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

## 5. Quality Baseline & Verification Matrix (Cập Nhật 2026-09-17)

| Chỉ số | Trạng thái thực tế | Ghi chú kiểm chứng |
|---|---|---|
| **TypeScript typecheck** | **PASS (0 errors)** | Cả backend (`tsc --noEmit`) và frontend (`vue-tsc --noEmit`) đạt chuẩn 100%. |
| **Production build** | **PASS** | `npm run build` biên dịch thành công schema manifest, Fastify dist và Vite SPA bundle. |
| **Clean install workspace** | **PASS** | Root `package-lock.json` duy nhất điều phối toàn bộ dependencies monorepo. |
| **Unit tests** | **PASS (309 tests)** | Backend: 25 files (224 tests gồm media outbound, attachment tickets, copilot debouncer, action items, burst sampling, noise filter, audit evaluator, audit rule service, zalo report sender, failover, quota, bounds); Frontend: 12 files (85 tests gồm media messaging, staged tray, custom icons, account colors, provider settings, audit rules, chat recovery, qr subscription). |
| **Integration test suites** | **24 test suites** | Kiểm thử Disposable Postgres: tenant isolation, Socket.IO delivery, message replay/undo, order code counter, AI budget & multi-provider failover. |
| **Browser E2E specs** | **10 specs** | Playwright: session lifecycle, QR intent, chat recovery, account permissions, target qualification. |
| **Dependency audit policy** | **PASS** | `npm run audit:production` kiểm soát chặt chẽ: chỉ chấp nhận 2 waiver Prisma CLI (`deepmerge-ts` / `GHSA-ggr8-5vv4-36mx`, `mysql2` / `GHSA-3f6p-5ww8-9rcr`). |
| **Số file mã nguồn > 200 dòng** | **45 files** | Được đưa vào danh mục theo dõi tái cấu trúc (refactoring inventory: 22 frontend, 23 backend). |

---

## 6. Hợp Đồng Kiến Trúc & Bất Biến Hệ Thống (Architectural Invariants)

- **AI Multi-Provider & Single-Layer Budget:**
  - `AiProviderRouter` hỗ trợ failover xuyên suốt `fallbackChain` kế thừa cấu hình hệ thống hoặc ghi đè cấp organization.
  - Tái sử dụng cùng một `attemptKey` xuyên suốt chuỗi failover; token budget chỉ hoàn tất một lần duy nhất khi provider thành công, ngăn chặn nguy cơ nhân đôi chi phí (double-reserve).
  - Kết nối AI Gateway bắt buộc HTTPS public và phân giải DNS chống loopback/private IP; chỉ cho phép private gateway khi có cờ `ALLOW_PRIVATE_AI_GATEWAYS=true`.
  - Cầu nối thị giác lai (`SmartHybridVisionBridge`) tự động OCR trích xuất ảnh hoặc chèn placeholder mô tả cho các mô hình thuần văn bản (DeepSeek).

- **Hạ Tầng Đo Lường & Theo Dõi Chi Phí AI (AI Telemetry & Pricing Matrix):**
  - Mọi tác vụ suy luận AI (Copilot, Executive Report, Audit Rule, Vision OCR, Test Connection) đều được đánh chặn và ghi nhật ký vào `ai_usage_logs`.
  - Bảng định giá `ai-pricing-catalog.ts` ánh xạ chi phí token input, output, cached theo USD và VND (tỷ giá mặc định 25.400).
  - Tích hợp rollup nguyên tử vào `daily_ai_usage_stats` qua SQL raw `INSERT ... ON CONFLICT DO UPDATE`, bảo đảm kháng race condition tuyệt đối.

- **Tin Nhắn Đa Phương Tiện, Khay Chờ & Streaming An Toàn (Media Staging & Streaming):**
  - Tệp tải lên được cô lập tại thư mục `uploads/attachments/staged/` với tiền tố `${orgId}-${uuid}-${sanitizedName}`.
  - Kiểm tra sâu tệp qua `image-size` và magic bytes signatures; giới hạn 15MB cho ảnh và 30MB cho tài liệu.
  - Luồng gửi Zalo sử dụng cơ chế vé ngắn hạn HMAC (60s) qua `GET /api/v1/attachments/:filename?ticket=...` cho phép server Zalo tải media mà không cần lộ JWT token của CRM.
  - Khi gửi Zalo API thất bại hoặc bị từ chối, áp dụng rollback nguyên tử: tệp staged giữ nguyên, không lưu bản ghi Message vào DB.
  - Cron dọn dẹp tệp mồ côi (`orphan-cleanup-task.ts`) tự động chạy mỗi giờ (`0 * * * *`) dọn sạch tệp staged quá 2 giờ mà không gửi.

- **Multimodal Burst Sampling & Two-Tier Cross-Verification:**
  - Khử trùng lặp ảnh ứng viên theo Base URL (`attachment-burst-sampler.ts`).
  - Lọc khử Prompt Injection đối với toàn bộ ngữ cảnh tin nhắn trước ảnh.
  - Tự động lấy mẫu ảnh: 100% nếu <= 3 ảnh; [ảnh đầu, ảnh giữa, ảnh cuối] nếu > 3 ảnh. Pool 4 worker xử lý đồng thời có anti-collision cache và trần cứng 12MB.
  - Tier 1: Chỉ thị Section 6 đối soát bắt buộc giữa báo cáo văn bản và bằng chứng hình ảnh.
  - Tier 2: Bóc tách Action Items (`report-action-item-parser.ts`), cho phép cập nhật trạng thái (`PUT /tasks/:taskId`) và phát sóng Zalo (`POST /broadcast-tasks`).

- **Zalo Account Rail, Branch & Color Tags:**
  - `ZaloAccount` hỗ trợ trường `branchTag` và `colorTag` (chọn từ 12 mã màu chuẩn nhận diện tại `account-colors.ts`).
  - Thanh điều hướng dọc `AccountRail.vue` gom nhóm unread count theo tài khoản, cho phép chuyển đổi tức thì không làm mất ngữ cảnh chat.
  - Đồng bộ tin nhắn gửi từ thiết bị ngoài (`selfListen: true`) với attribution `self`, tự lành liên kết Contact và cập nhật tên Zalo khi nhận phản hồi.
  - Rate limit 2 tầng: giới hạn ngày 200 tin (tính cả tin từ mobile/iPad) nhưng tách biệt với nhịp burst tương tác (3 tin/30s) trên Dashboard. Tin nhắn media áp dụng trọng số gấp đôi (`weight = files.length * 2`) để bảo vệ tài khoản Zalo.

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

Ma trận HTTP/PostgreSQL/Socket.IO/browser và container smoke đã có đầy đủ trong source. Trạng thái kiểm chứng local đã hoàn tất; bước nghiệm thu cuối cùng cần xác nhận qua hosted CI tại remote repository.
