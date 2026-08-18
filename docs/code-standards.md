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

## 4. Chuẩn Mực Frontend (Vue 3 + Vuetify 3)

### 4.1. Vue 3 Standard
- Bắt buộc dùng **Composition API** với cú pháp `<script setup lang="ts">`.
- Tránh mutate trực tiếp state từ ngoài Pinia store.
- Sử dụng Vuetify 3 grid system (`v-container`, `v-row`, `v-col`) thay vì viết CSS layout tĩnh với pixel cố định (`width: 350px`).

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
