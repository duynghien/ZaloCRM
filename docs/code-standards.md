# ZaloCRM — Coding Standards & Development Guidelines

## 1. Nguyên Tắc Cốt Lõi (Core Principles)

Mọi mã nguồn đóng góp vào dự án ZaloCRM phải tuân thủ nghiêm ngặt 3 nguyên tắc phát triển:
1. **YAGNI (You Aren't Gonna Need It):** Chỉ viết những tính năng cần thiết hiện tại, không thêm các trừu tượng hóa phức tạp trước thời hạn.
2. **KISS (Keep It Simple, Stupid):** Giữ cho giải pháp đơn giản nhất có thể. Mã nguồn ngắn gọn, dễ đọc tốt hơn mã nguồn cầu kỳ.
3. **DRY (Don't Repeat Yourself):** Tái sử dụng logic qua các module shared/helpers thay vì sao chép mã nguồn.

---

## 2. Quy Định Modularization (Quy định 200 Dòng Code)

> [!IMPORTANT]
> - Nếu một file mã nguồn vượt quá **200 dòng code**, lập trình viên cần chủ động tách nhỏ thành các sub-modules/components độc lập.
> - **Đặt tên file:** Sử dụng định dạng `kebab-case` dài và mang tính mô tả rõ ràng (ví dụ: `zalo-health-check.ts`, `appointment-reminder.ts`, `order-code-service.ts`).
> - **Ngoại lệ không tách:** File cấu hình (`package.json`, `tsconfig.json`), Markdown (`.md`), hoặc Docker Compose.

**Danh sách 52 files hiện tại đang vượt 200 dòng được theo dõi để tái cấu trúc (Refactoring Backlog):**
- *Frontend (21 files):* `AiReportsView.vue` (1828), `MessageThread.vue` (801), `AiAuditRuleDialog.vue` (457), `AiProviderSettingsCard.vue` (395), `ai-report-api.ts` (381), `AccountRail.vue` (368), `AiAuditRulesCard.vue` (340), `use-chat.ts` (317), `use-zalo-accounts.ts` (307), `ChatView.vue` (294), `AppointmentsView.vue` (292), `ConversationList.vue` (283), `ChatAppointments.vue` (271), `ZaloAccountEditDialog.vue` (269), `OrdersView.vue` (265), `TeamManagement.vue` (264), `ZaloAccountCard.vue` (249), `SettingsView.vue` (238), `ZaloAccountsView.vue` (237), `ContactDetailDialog.vue` (236), `GlobalSearch.vue` (229).
- *Backend (31 files):* `ai-report-routes.ts` (790), `report-pdf-service.ts` (598), `zalo-pool.ts` (529), `summarizer-service.ts` (519), `zalo-report-sender.ts` (458), `attachment-burst-sampler.ts` (414), `ai-audit-rule-service.ts` (403), `attachment-image-loader.ts` (399), `chat-routes.ts` (381), `attachment-routes.ts` (372), `attachment-parser.ts` (367), `report-brief-service.ts` (349), `noise-filter.ts` (344), `ai-audit-evaluator-helpers.ts` (324), `ai-audit-evaluator.ts` (324), `contact-routes.ts` (313), `public-api-routes.ts` (299), `zalo-routes.ts` (296), `message-handler.ts` (273), `zalo-listener-factory.ts` (270), `ai-provider-settings-service.ts` (250), `attachment-validator.ts` (245), `attachment-processor.ts` (240), `outbound-url-policy.ts` (237), `order-routes.ts` (233), `visual-fact-extractor.ts` (225), `appointment-routes.ts` (219), `zalo-text-formatter.ts` (215), `email-service.ts` (210), `openai-compatible-provider.ts` (210), `ai-provider-router.ts` (204).

---

## 3. Chuẩn Mực Backend (Fastify + TypeScript + Prisma)

### 3.1. Cấu trúc Module Backend
Mỗi tính năng backend nằm trong thư mục `src/modules/<feature-name>/`:
- `<feature>-routes.ts`: Đăng ký URL endpoints và middleware xác thực.
- `<feature>-service.ts`: Xử lý business logic chính.
- `<feature>-types.ts`: Định nghĩa dữ liệu TypeScript interfaces / DTOs.

### 3.2. Xử lý Lỗi & Logging
- Tuyệt đối không dùng `console.log`, bắt buộc dùng `logger` từ `src/shared/utils/logger.ts`.
- Không bắt ngoại lệ để trả về fallback rỗng hoặc nuốt lỗi âm thầm. Trả về đúng HTTP Status Code (`400`, `401`, `403`, `404`, `500`) kèm thông điệp lỗi rõ ràng:

```typescript
// Good Example
if (!account) {
  return reply.status(404).send({ error: 'zalo_account_not_found' });
}
```

---

## 4. Chuẩn Mực Frontend (Vue 3 + Vuetify 4 + Neo-Brutalism)

### 4.1. Vue 3 Standard & Composition API
- Bắt buộc dùng **Composition API** với cú pháp `<script setup lang="ts">`.
- Tránh mutate trực tiếp state từ ngoài Pinia store.
- Sử dụng Vuetify 4 grid system (`v-container`, `v-row`, `v-col`) thay vì viết CSS layout tĩnh với pixel cố định.

### 4.2. Quy Chuẩn Neo-Brutalism CQA
- **100% Zero Shadow:** Tuyệt đối không dùng `box-shadow` mờ ảo.
- **Crisp Mechanical Borders:** Đường viền cơ học `1.5px solid #18181B` (light) / `#3F3F46` (dark) cho mọi container, card, input, table.
- **Bán kính góc CQA:** Card/Dialog/Table/Chat bubble = 12px; Button/Input/Icon-box = 8px; Status Chip/Badge = 9999px (viên thuốc `.neo-pill`).
- **Typography:** Tiêu đề dùng Space Grotesk (`.neo-page-title` in hoa in nghiêng đậm với `.neo-title-accent`), nội dung dùng Plus Jakarta Sans.
- **Biểu tượng:** Ưu tiên sử dụng Custom SVG Icons (`custom-icons.ts`) và Brand SVG Icons chính hãng thay vì generic font icons.
- **Mã màu tài khoản Zalo:** Sử dụng bảng 12 màu quy chuẩn từ `account-colors.ts` (Blue, Emerald, Violet, Amber, Rose, Cyan, Orange, Slate, Indigo, Teal, Fuchsia, Lime).

### 4.3. Quản lý State với Pinia & In-Memory Session
- Các store nằm tại `src/stores/<feature>-store.ts`.
- Tách biệt giữa State, Actions (call API) và Getters (bộ lọc/tính toán).
- JWT Access Token ngắn hạn chỉ lưu trong bộ nhớ RAM client (`session.ts`), không ghi vào `localStorage` hay `sessionStorage`.

---

## 5. Quy Chuẩn Đặt Tên (Naming Conventions)

| Đối tượng | Quy chuẩn | Ví dụ |
|-----------|-----------|-------|
| **File & Thư mục** | `kebab-case` | `contact-routes.ts`, `zalo-pool.ts` |
| **Class & Interface** | `PascalCase` | `ZaloService`, `JwtPayload` |
| **Variable & Function** | `camelCase` | `getUserById`, `zaloAccountId` |
| **Database Table & Column** | `snake_case` | `zalo_accounts`, `password_hash` |
| **Constant / Env** | `UPPER_SNAKE_CASE` | `ENCRYPTION_KEY`, `MAX_RETRIES` |

---

## 6. Quy Trình Git & Conventional Commits

Tất cả các commit phải tuân thủ chuẩn **Conventional Commits**:

- `feat(chat):` Thêm tính năng gửi tin nhắn thoại Zalo
- `fix(auth):` Sửa lỗi hết hạn JWT token không tự đăng xuất
- `docs(api):` Cập nhật tài liệu API công khai
- `refactor(zalo):` Tách nhỏ ZaloPool thành sub-modules
- `chore(deps):` Cập nhật phiên bản thư viện npm

---

## 7. Quy Định Bảo Mật (Security Guidelines)

1. **Không Hardcode Secrets:** Không commit token, mật khẩu, JWT secret hoặc private key lên repository.
2. **Xác thực Đầu vào:** Kiểm tra và làm sạch dữ liệu đầu vào (Input Sanitization) phòng chống XSS và SQL Injection.
3. **Mã hóa dữ liệu nhạy cảm:** Mọi thông tin phiên Zalo, AI API Keys và mật khẩu SMTP phải đi qua hàm mã hóa AES-256-GCM trước khi ghi vào cơ sở dữ liệu.

### 7.1. Tenant, RBAC và ACL

- Mọi route phải kiểm tra `orgId` tại điểm đọc và điểm ghi. Không dùng `update({ where: { id } })` hoặc `delete({ where: { id } })` nếu chưa chứng minh bản ghi thuộc tenant hiện tại.
- Mọi foreign key do client gửi (`contactId`, `conversationId`, `assignedUserId`, `teamId`, `zaloAccountId`) phải được kiểm tra thuộc cùng organization trước khi ghi.
- Quyền `owner`, `admin`, `member` và `ZaloAccountAccess` phải được thực thi ở backend cho REST lẫn Socket.IO. Ẩn menu ở frontend chỉ là UX, không phải kiểm soát truy cập.
- Token của người dùng bị khóa, đổi mật khẩu hoặc hạ quyền phải bị thu hồi hoặc được đối chiếu trạng thái hiện tại ở server.

### 7.2. Secret, Outbound Request & AI Gateway SSRF

- Webhook secret, AI Provider API keys và mật khẩu SMTP phải lưu mã hóa; không dùng `valuePlain` cho các credential này. Public API key là ngoại lệ sản phẩm đã chấp nhận: vẫn plaintext/recoverable cho Owner/Admin nhưng phải có `Cache-Control: no-store`, audit trail, redaction trong log/error và không cache ở client/proxy.
- URL webhook/attachment là dữ liệu không tin cậy. Chỉ cho phép host tin cậy hoặc phải chặn loopback, private, link-local, metadata IP cho cả IPv4/IPv6 sau DNS resolution và sau mỗi redirect qua `outbound-url-policy.ts`.
- Mọi Custom AI Gateway URL phải được kiểm tra nghiêm ngặt qua `ai-gateway-validator.ts`. Chặn mọi kết nối loopback/private mạng LAN trừ khi bật cờ `ALLOW_PRIVATE_AI_GATEWAYS=true`.
- Downloader phải giới hạn byte trong lúc stream, không đọc toàn bộ response không giới hạn vào RAM. Parser cần giới hạn trang, sheet, cell và thời gian xử lý.

### 7.3. Multimodal Image & Prompt Injection Defense

- Lọc khử Prompt Injection đối với toàn bộ ngữ cảnh tin nhắn trước ảnh trước khi đưa vào multimodal prompt.
- Khử trùng lặp ảnh ứng viên theo Base URL (`attachment-burst-sampler.ts`).
- Chặn đứng mọi nỗ lực tấn công Path Traversal khi nạp tệp ảnh cục bộ (`attachment-image-loader.ts`).
### 7.4. Bảo Mật Tệp Đính Kèm & Streaming Media

- Xác thực sâu kiểu MIME qua chữ ký magic bytes (`image-size`) ngăn chặn triệt để kỹ thuật Polyglot file và tệp thực thi giả mạo đuôi ảnh.
- Chuẩn hóa tên tệp chống Path Traversal (`sanitize-filename`), phân tách thư mục staged và committed cô lập theo tenant ID.
- Vé streaming HMAC-SHA256 ngắn hạn (60s) cho phép Zalo CDN nạp media mà không để lộ JWT token.
- Header bảo vệ dòng stream: `Content-Disposition: inline/attachment`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox; default-src 'none'`.

---

## 8. API Validation & Reliability

- Boundary HTTP phải kiểm tra body/params/query và response quan trọng. Source hiện dùng shared strict validators và route hooks; không ghi nhận toàn bộ route đã có Fastify JSON Schema.
- Pagination chỉ nhận số nguyên đúng định dạng trong giới hạn (`page >= 1`, `1 <= limit <= 100`); input sai trả `400`, không clamp hoặc fallback. Mặc định chỉ áp dụng khi bỏ qua trường.
- Body null/array/scalar bị từ chối khi endpoint cần object. Nullability theo từng contract: tạo order cho phép `notes`/`conversationId: null`; update `notes: null` xóa ghi chú, omission giữ nguyên.
- Ngày phải tồn tại theo lịch; timestamp cần timezone. Chuẩn hóa UTC trước so sánh; AI chấp nhận chênh lệch không quá 30 × 24 giờ (31 ngày lịch gồm hai đầu), tối đa 20 cặp nguồn và 10 email đã chuẩn hóa không trùng.
- Order code phải cấp trong transaction tạo order bằng counter org/ngày UTC và unique DB; không dùng count hoặc tự sửa mã trùng legacy.
- AI source phải giữ account/thread/conversation đã resolve; sender chọn rõ, resend có idempotency ledger. Không tự retry dispatch claimed/uncertain hoặc reset ngân sách khi recovery.
- Single-Layer Budget Reservation cho AI failover: tái sử dụng `attemptKey`, chỉ hoàn tất trừ ngân sách một lần duy nhất khi có provider thành công.
- Liveness và readiness tách biệt. Readiness phải trả HTTP `503` khi database hoặc dependency bắt buộc không sẵn sàng.
- Không tiếp tục chạy sau `uncaughtException` trong trạng thái không xác định. Thực hiện graceful shutdown cho HTTP, Socket.IO, Prisma, cron và Zalo listeners.

---

## 9. Quality Gates

Trước merge hoặc release, tối thiểu phải chạy trên clean install:

```bash
npm ci
npm run prisma:generate
npm run typecheck
npm run build
npm test
npm run audit:production
npm run test:e2e
npm run verify:production-container
npm run verify:development-compose
```

- `npm test` chạy toàn bộ test unit của cả backend và frontend workspace (hiện đạt **409 passing unit tests**: 324 backend + 85 frontend); không bao gồm Playwright (`npm run test:e2e`).
- Integration fixture PostgreSQL 16 disposable: local cần Docker daemon hoạt động; CI cần PostgreSQL service riêng đã migrate. Fixture phải dùng chính app/auth/socket production, DB và session thật; không trỏ vào DB production hoặc thay Prisma bằng mock để chứng minh tenant/ACL isolation.
- Root hiện chưa có script `lint`; không chạy hoặc ghi nhận `npm run lint` đã pass. Cần cấu hình script trước khi đưa lint thành gate bắt buộc.
- Lockfile dùng trong Docker phải đồng bộ với manifest tương ứng.
- Thay đổi auth, tenant boundary, webhook, file parser, AI multi-provider, attachment sampler và message ingestion bắt buộc có test regression.
- CI phải chặn merge khi test, typecheck, build hoặc dependency audit vượt ngưỡng đã chấp nhận; lint áp dụng sau khi có cấu hình. Chỉ xác nhận CI/release khi có kết quả thực tế của revision tương ứng.
- Production audit chặn mọi advisory ngoài hai waiver Prisma CLI khóa version/path: `deepmerge-ts` / `GHSA-ggr8-5vv4-36mx`, `mysql2` / `GHSA-3f6p-5ww8-9rcr`. Không waiver `uuid`; waiver lệch version/path/consumer graph phải fail.
- Gate hành vi phải có test HTTP/DB/Socket/browser thực, không dùng source-string assertions hay suite bị skip/0 test thay bằng chứng. Local pass không thay hosted CI tại commit cuối.
