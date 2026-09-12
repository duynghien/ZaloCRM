# ZaloCRM — Product & Technical Development Roadmap

## 1. Tổng Quan Lộ Trình (Roadmap Summary)

Lộ trình phát triển **ZaloCRM** được chi làm 6 giai đoạn chiến lược, tập trung từ việc ổn định kết nối đa Zalo cá nhân, mở rộng tính năng CRM quản lý khách hàng, tích hợp API công khai cho tới nâng cao hạ tầng bảo mật, tự động hóa kiểm thử và tích hợp trí tuệ nhân tạo (AI Assistant).

```mermaid
gantt
    title Lộ trình Phát triển Hệ thống ZaloCRM
    dateFormat  YYYY-MM
    section Core Infrastructure
    Core Zalo & Chat           :done,    des1, 2026-01, 2026-03
    CRM Pipeline & Orders      :done,    des2, 2026-03, 2026-05
    Public API & Webhook       :done,    des3, 2026-05, 2026-07
    section Quality & Security
    Security & Build Docs      :active,  des4, 2026-08, 2026-09
    Automated Testing & CI/CD  :active,    des5, 2026-09, 2026-09
    section Intelligence
    AI Sales Assistant (Phase 6):        des6, 2026-11, 2027-02
```

---

## 2. Chi Tiết Các Giai Đoạn (Detailed Phases)

### Phase 1: Core Multi-Zalo & Real-time Chat (ĐÃ HOÀN THÀNH)
- [x] Quản lý đa tài khoản Zalo cá nhân (Đăng nhập QR, lưu session AES-256).
- [x] Giao diện Live Chat real-time qua Socket.IO (gửi/nhận tin nhắn, ảnh, file, sticker, hội thoại nhóm).
- [x] Phân quyền người dùng (Owner, Admin, Member) và bảng kiểm soát truy cập Zalo (`ZaloAccountAccess`).

### Phase 2: CRM Pipeline, Appointments & Reports (ĐÃ HOÀN THÀNH)
- [x] Đường ống quản lý khách hàng (Pipeline 5 trạng thái).
- [x] Đặt lịch hẹn và tự động nhắc lịch hẹn chạy ẩn hàng ngày (`startAppointmentReminder`).
- [x] Thống kê Dashboard & Xuất báo cáo hiệu suất ra file Excel (`exceljs`).

### Phase 3: Public REST API & Webhook Gateway (ĐÃ HOÀN THÀNH)
- [x] Khởi tạo hệ thống REST API công khai xác thực bằng `X-API-Key`.
- [x] Hệ thống gửi thông báo sự kiện qua Webhook cho ứng dụng bên ngoài.

---

### Phase 4: Hardening Bảo Mật & Chuẩn Hóa Quy Trình Build (ĐÃ HOÀN THÀNH TRIỂN KHAI)
- [x] Đóng toàn bộ 10 phát hiện (4 HIGH, 5 MEDIUM, 1 LOW) từ đợt audit sau remediation (commit `d075642`).
- [x] Đồng bộ các lệnh build, dev, typecheck thông qua file `package.json` tại root repository.
- [x] Sửa tenant/RBAC/ACL ở Orders, Zalo, Chat, Socket.IO và AI Reports; member vẫn xem toàn bộ contact nhưng dữ liệu Zalo/AI phải theo account ACL.
- [x] Chặn SSRF ở webhook/attachment downloader (`outbound-url-policy.ts`) và giới hạn tài nguyên parser/download stream.
- [x] Chuẩn hóa một root workspace `package-lock.json`; bỏ dependency vào lockfile backend/frontend riêng và dùng cùng graph trong Docker/CI.
- [x] Nâng Node.js 20 đã EOL; Node.js 24 LTS đã áp dụng. Hai advisory upstream trong Prisma 7.10 được chấp nhận có điều kiện qua allowlist nghiêm ngặt (`scripts/audit-production-policy.mjs`).
- [x] Chuyển AI Reports khỏi model `gemini-2.0-flash` đã shutdown sang `GEMINI_MODEL` được provider xác thực lúc startup; có `npm run ai:smoke --workspace=backend` cho môi trường có API key.
- [x] Chuyển đổi quy trình Docker Production sang `prisma migrate deploy` với image migrator độc lập, nâng cao tính toàn vẹn dữ liệu.
- [x] Áp dụng tài khoản phi đặc quyền `USER node` trong container ứng dụng và cấu hình loopback port binding.

---

### Phase 5: Kiểm Thử Tự Động & CI/CD Pipeline (ĐÃ HOÀN THÀNH TRIỂN KHAI LOCAL)
- [x] Bổ sung Vitest unit/contract tests cho policy outbound, secret codec, AI job bounds và các security/runtime invariant P1 (77 backend + 21 frontend unit tests).
- [x] Bổ sung browser smoke Playwright (10 spec files) xác nhận login route, QR intent, chat recovery, target qualification và không khôi phục bearer token qua persistent storage.
- [x] Bổ sung bộ 20 integration test suites chạy trên PostgreSQL 16 disposable cho tenant isolation, socket delivery, message replay/undo, order code counter và AI budget/resend.
- [x] Tích hợp GitHub Actions (`.github/workflows/ci.yml`) chạy root `npm ci`, typecheck, backend test, build, production audit, Playwright smoke và Docker build trên pull request/main.
- [x] Bổ sung các kịch bản kiểm chứng container smoke: `npm run verify:production-container` và `npm run verify:development-compose`.

---

### Phase 6: Tích Hợp AI Sales Assistant (KẾ HOẠCH BẮT ĐẦU 11/2026)
- [ ] Tích hợp LLM API (Claude 3.5 Sonnet / Gemini 1.5 Pro) gợi ý câu trả lời tự động cho nhân viên tư vấn.
- [ ] Tự động phân tích tâm lý khách hàng (Sentiment Analysis) và tóm tắt nội dung cuộc trò chuyện dài.
- [ ] Tự động trích xuất thông tin khách hàng từ tin nhắn hội thoại để tạo hồ sơ Contact / Order tự động.


## 3. Cập nhật remediation — 2026-09-13

Toàn bộ 5 pha của [Kế hoạch remediation](../plans/260902-1756-post-remediation-audit-fixes/plan.md) đã được lập trình, kiểm thử và tích hợp hoàn tất vào working tree (commit `d075642`):

| Phạm vi | Trạng thái |
|---|---|
| Socket session/account ACL, QR intent, reminder org, REST resync | Đã hoàn thành và kiểm chứng qua unit, integration & browser tests |
| AI account-qualified targets, legacy migration, budgets, sender/resend ledger | Đã hoàn thành và kiểm chứng qua unit, integration & browser tests |
| Strict input/null/date, order counter/unique, message replay/undo | Đã hoàn thành và kiểm chứng qua unit & integration tests |
| Production audit policy, Docker runtime/dev, migration drain gate | Đã hoàn thành và kiểm chứng qua container smoke scripts |
| Hệ thống tài liệu kỹ thuật (`docs/`) | Đã đồng bộ hoàn toàn với codebase thực tế |
| Commit cuối và xác nhận hosted CI | Đang chờ nghiệm thu trên remote repository CI |
