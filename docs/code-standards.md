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
> - **Đặt tên file:** Sử dụng định dạng `kebab-case` dài và mang tính mô tả rõ ràng (ví dụ: `zalo-health-check.ts`, `appointment-reminder.ts`).
> - **Ngoại lệ không tách:** File cấu hình (`package.json`, `tsconfig.json`), Markdown (`.md`), hoặc Docker Compose.

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

## 4. Chuẩn Mực Frontend (Vue 3 + Vuetify 4)

### 4.1. Vue 3 Standard
- Bắt buộc dùng **Composition API** với cú pháp `<script setup lang="ts">`.
- Tránh mutate trực tiếp state từ ngoài Pinia store.
- Sử dụng Vuetify 4 grid system (`v-container`, `v-row`, `v-col`) thay vì viết CSS layout tĩnh với pixel cố định (`width: 350px`).

### 4.2. Quản lý State với Pinia
- Các store nằm tại `src/stores/<feature>-store.ts`.
- Tách biệt giữa State, Actions (call API) và Getters (bộ lọc/tính toán).

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
3. **Mã hóa dữ liệu nhạy cảm:** Mọi thông tin phiên Zalo phải đi qua hàm mã hóa AES-256 trước khi ghi vào cơ sở dữ liệu.

### 7.1. Tenant, RBAC và ACL

- Mọi route phải kiểm tra `orgId` tại điểm đọc và điểm ghi. Không dùng `update({ where: { id } })` hoặc `delete({ where: { id } })` nếu chưa chứng minh bản ghi thuộc tenant hiện tại.
- Mọi foreign key do client gửi (`contactId`, `conversationId`, `assignedUserId`, `teamId`, `zaloAccountId`) phải được kiểm tra thuộc cùng organization trước khi ghi.
- Quyền `owner`, `admin`, `member` và `ZaloAccountAccess` phải được thực thi ở backend cho REST lẫn Socket.IO. Ẩn menu ở frontend chỉ là UX, không phải kiểm soát truy cập.
- Token của người dùng bị khóa, đổi mật khẩu hoặc hạ quyền phải bị thu hồi hoặc được đối chiếu trạng thái hiện tại ở server.

### 7.2. Secret và outbound request

- API key, webhook secret và mật khẩu SMTP phải lưu mã hóa; không dùng `valuePlain` cho credential có thể tái sử dụng.
- URL webhook/attachment là dữ liệu không tin cậy. Chỉ cho phép host tin cậy hoặc phải chặn loopback, private, link-local, metadata IP cho cả IPv4/IPv6 sau DNS resolution và sau mỗi redirect.
- Downloader phải giới hạn byte trong lúc stream, không đọc toàn bộ response không giới hạn vào RAM. Parser cần giới hạn trang, sheet, cell và thời gian xử lý.

---

## 8. API Validation & Reliability

- Mọi route khai báo Fastify JSON Schema cho `body`, `params`, `querystring` và response quan trọng.
- Pagination phải ép `page >= 1`, `1 <= limit <= 100`; date range, số group và kích thước payload phải có trần.
- Liveness và readiness tách biệt. Readiness phải trả HTTP `503` khi database hoặc dependency bắt buộc không sẵn sàng.
- Không tiếp tục chạy sau `uncaughtException` trong trạng thái không xác định. Thực hiện graceful shutdown cho HTTP, Socket.IO, Prisma, cron và Zalo listeners.

---

## 9. Quality Gates

Trước merge hoặc release, tối thiểu phải chạy trên clean install:

```bash
npm ci
npm run typecheck
npm run build
npm test
npm run lint
npm audit --workspaces --include-workspace-root
```

- Lockfile dùng trong Docker phải đồng bộ với manifest tương ứng.
- Thay đổi auth, tenant boundary, webhook, file parser và message ingestion bắt buộc có test regression.
- CI phải chặn merge khi test, lint, typecheck, build hoặc dependency audit vượt ngưỡng đã chấp nhận.
