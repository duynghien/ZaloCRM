# ZaloCRM — Project Overview & Product Requirements Document (PRD)

## 1. Executive Summary

**ZaloCRM** là hệ thống quản lý tập trung nhiều tài khoản Zalo cá nhân dành cho doanh nghiệp, chủ cửa hàng, đội ngũ bán hàng và hỗ trợ khách hàng. Hệ thống hỗ trợ tương tác trò chuyện real-time, quản lý khách hàng theo đường ống bán hàng (Pipeline), đặt và nhắc lịch hẹn tự động, báo cáo thống kê hiệu suất làm việc, cùng hệ thống API công khai và Webhook hỗ trợ tích hợp với các hệ thống bên ngoài.

---

## 2. Tầm Nhìn & Mục Tiêu (Vision & Objectives)

### 2.1. Tầm nhìn
Trở thành giải pháp CRM Zalo mượt mà, an toàn và dễ triển khai nhất dành cho các doanh nghiệp vừa và nhỏ (SME) tại Việt Nam, giúp tối ưu hóa quy trình chăm sóc khách hàng và gia tăng tỷ lệ chuyển đổi đơn hàng qua Zalo.

### 2.2. Mục tiêu kỹ thuật & kinh doanh
- **Quản lý đa tài khoản:** Đăng nhập và duy trì đồng thời nhiều tài khoản Zalo cá nhân trên một giao diện Web duy nhất mà không bị trùng lặp hay xung đột phiên.
- **Phản hồi tức thì (Real-time):** Đồng bộ tin nhắn hai chiều giữa Zalo và CRM dưới 1 giây qua kết nối WebSocket (Socket.IO).
- **An toàn & Chống khóa tài khoản:** Tự động giới hạn tốc độ gửi tin (Rate Limiting), chia nhỏ luồng gửi tin và lưu trữ thông tin phiên làm việc an toàn.
- **Dễ dàng Triển khai & Bảo trì:** Đóng gói toàn bộ ứng dụng bằng Docker Compose, quy trình triển khai 1-click đơn giản trên bất kỳ VPS Linux nào.

---

## 3. Phạm Vi Tính Năng (Feature Scope)

### 3.1. Phân hệ Quản lý Tài khoản Zalo
- **Đăng nhập QR Code:** Tạo mã QR đăng nhập trực quan, tự động cập nhật trạng thái khi quét thành công.
- **Lưu & Tự khôi phục phiên:** Mã hóa dữ liệu session (cookie, IMEI) bằng thuật toán AES-256-GCM. Tự động kết nối lại khi mất mạng hoặc khởi động lại ứng dụng.
- **Giới hạn an toàn:** Cấu hình giới hạn số lượng tin nhắn gửi đi trong ngày (ví dụ: tối đa 200 tin/ngày) và phát hiện gửi tin quá nhanh.

### 3.2. Phân hệ Trò chuyện Real-time (Live Chat)
- **Giao diện đa cửa sổ:** Danh sách cuộc trò chuyện theo tài khoản Zalo, bộ lọc tin nhắn chưa trả lời, tìm kiếm hội thoại.
- **Đa phương tiện:** Gửi/nhận tin nhắn văn bản, hình ảnh, tập tin (PDF, Docx,...), sticker và hiển thị tin nhắn nhóm.
- **Trạng thái phản hồi:** Theo dõi tin nhắn chưa trả lời quá 30 phút, nhắc nhở nhân viên sale hỗ trợ kịp thời.

### 3.3. Phân hệ Quản lý Khách hàng (CRM Contacts & Pipeline)
- **Phân loại Pipeline:** Quản lý trạng thái khách hàng qua 5 giai đoạn: `Mới (new)` → `Đã liên hệ (contacted)` → `Quan tâm (interested)` → `Chuyển đổi (converted)` → `Mất (lost)`.
- **Hồ sơ khách hàng:** Lưu trữ thông tin cá nhân, nguồn khách hàng (Facebook, TikTok, Giới thiệu,...), người phụ trách (Assigned Sales), ghi chú và thẻ (Tags).

### 3.4. Phân hệ Quản lý Đơn hàng (Orders & Sales)
- **Vòng đời đơn hàng:** Tạo và theo dõi đơn hàng gắn liền với từng khách hàng và cuộc trò chuyện; hỗ trợ các trạng thái `new`, `confirmed`, `paid`, `shipped`, `completed`, `cancelled`.
- **Cấp mã tuần tự nguyên tử:** Tự động sinh mã định dạng `ORD-YYYYMMDD-NNN` (UTC) qua bảng `order_code_counters` trong cùng giao dịch database, loại bỏ hoàn toàn race condition và xung đột mã khi nhiều nhân viên tạo đơn cùng thời điểm.
- **Thống kê bán hàng:** Báo cáo doanh thu, số lượng đơn theo trạng thái và hiệu suất doanh số theo từng nhân viên.

### 3.5. Phân hệ Lịch hẹn & Nhắc nhở (Appointments)
- **Quản lý lịch hẹn:** Đặt lịch hẹn làm việc, tư vấn hoặc khám bệnh với khách hàng theo ngày giờ cụ thể.
- **Tự động nhắc lịch:** Tiến trình chạy ẩn (Cron Job) tự động kiểm tra định kỳ và gửi thông báo nhắc lịch hẹn sắp tới qua Socket.IO và Zalo.

### 3.6. Phân hệ Báo cáo Điều hành AI Digest (AI Reports v2)
- **Động cơ Tóm tắt 2 tầng (Hierarchical Map-Reduce):** Tổng hợp lượng tin nhắn lớn từ các nhóm Zalo bằng mô hình Gemini (`GEMINI_MODEL`, mặc định `gemini-3.6-flash`).
- **Lọc nhiễu & Ngân sách an toàn:** Tự động loại bỏ tin nhắn rác/chào hỏi; quản lý nghiêm ngặt ngân sách token và số lượng tin nhắn dưới cơ chế lease fence (`report-job-budget.ts`).
- **Đóng băng nguồn bất biến:** Cố định mục tiêu `(orgId, zaloAccountId, groupThreadId, conversationId)` trong job schema v2, tránh thất lạc hoặc sai lệch tài khoản nguồn.
- **Tự động hóa & Gửi lại (Resend):** Hỗ trợ lập lịch tự động gửi qua Zalo/Email SMTP theo Cron; hỗ trợ gửi lại với `Idempotency-Key` và ledger kiểm soát trạng thái gửi (`sent`, `failed`, `deliveryUncertain`).

### 3.7. Phân hệ Quy Tắc Giám Sát Nhóm AI & Điều Phối Kép (Scheduled AI Group Audit Rules & Multi-Channel Dispatch)
- **Kiểm tra tuân thủ đa kịch bản:** Thiết lập các quy tắc đánh giá tự động theo từng nhóm Zalo với 4 kịch bản nghiệp vụ: *Nộp lịch/kế hoạch ngày* (`schedule_submission`), *Tiến độ công việc/KPI* (`work_progress`), *Thẩm định hình ảnh/biên bản* (`image_verification` qua Multimodal Vision tối đa 15 ảnh <= 12MB), và *Tùy chỉnh* (`custom`).
- **Phân giải nhân sự Hybrid chống thiên kiến:** Phân giải thành viên nhóm tự động qua `getGroupInfo` và bộ đệm cache thành viên (không suy diễn từ tin nhắn chat để tránh hiện tượng thiên kiến sống sót). Hỗ trợ Fuzzy & Alias matching linh hoạt theo biệt danh, bỏ qua emoji/phòng ban.
- **Điều phối kép (Dual-Channel Dispatch):** Tự động phát hành kết quả thẩm định phân loại 3 tầng (*Đã xong*, *Chưa ghi nhận/Cần đối chiếu*, *Bất thường/Nộp muộn*) sang Nhóm Zalo Giám sát (`threadType = 1`), đồng thời gửi thông điệp nhắc nhở tất định, lịch sự điểm danh vào Nhóm Zalo Vận hành nguồn trong `try/catch` độc lập.
- **Kháng Prompt Injection 100%:** Tin nhắn nhắc nhở vận hành được tạo tất định qua mã TypeScript từ telemetry có cấu trúc, loại trừ rủi ro bị can thiệp bởi prompt injection từ tin nhắn độc hại trong nhóm chat.
- **Kiểm thử tức thì (Run Now):** Cho phép Owner/Admin kích hoạt đánh giá đồng bộ trả kết quả ngay (< 15s) với Direct Execution Lease trên `ai_report_jobs`, liên kết Token Budget và lưu trữ chuẩn schema v2 vào `GeneratedReport`.

### 3.8. Phân hệ Quản trị & Phân quyền (RBAC & Team Management)
- **Tổ chức (Organization):** Mô hình Multi-Tenant, dữ liệu của mỗi tổ chức được cô lập hoàn toàn.
- **Vai trò người dùng:**
  - `Owner`: Quyền cao nhất, quản lý tổ chức, phân quyền Admin/Member và toàn bộ hệ thống.
  - `Admin`: Quản lý nhân sự, danh mục, cấu hình Zalo và xem báo cáo.
  - `Member`: Xem toàn bộ contact trong organization; chỉ truy cập hội thoại và tài khoản Zalo được cấp qua `ZaloAccountAccess`.
- **Phân quyền AI Reports:** Cả `owner`, `admin` và `member` đều được sử dụng. Owner/Admin có phạm vi toàn organization; Member chỉ đọc/generate/resend dữ liệu từ Zalo account nằm trong ACL của mình. Cấu hình cấp organization như SMTP, lịch tự động và quy tắc giám sát chỉ Owner/Admin được thay đổi.

### 3.9. Phân hệ Tích hợp API & Webhook
- **Public REST API:** Cung cấp các endpoint RESTful được xác thực bằng `X-API-Key` cho phép hệ thống bên ngoài tạo/lấy danh sách khách hàng, lịch hẹn, gửi tin nhắn.
- **Webhook Subscriptions:** Đăng ký nhận sự kiện real-time: `message.received`, `message.sent`, `contact.created`, `zalo.connected`, `zalo.disconnected` với chữ ký bảo mật HMAC SHA-256.

---

## 4. Yêu Cầu Phi Chức Năng (Non-Functional Requirements)

### 4.1. Hiệu năng (Performance)
- Thời gian phản hồi API < 200ms đối với 95% các yêu cầu thông thường.
- Hỗ trợ tối thiểu 50 cuộc hội thoại Zalo hoạt động đồng thời trên VPS cấu hình 2 vCPU / 4GB RAM.
- Hàng đợi Socket.IO đệm tối đa 100 sự kiện/account, tự động gửi tín hiệu resync khi tràn.

### 4.2. Bảo mật (Security)
- Mật khẩu người dùng được băm bằng thuật toán `bcryptjs` với salt round 12.
- Access token JWT ngắn hạn (15 phút) lưu hoàn toàn trong bộ nhớ RAM trình duyệt (`session.ts`), không ghi vào `localStorage` hay `sessionStorage`.
- Refresh token dạng opaque lưu SHA-256 digest trong bảng `auth_sessions`, xoay vòng phiên khi cấp token mới (single-use rotation), tự động thu hồi toàn bộ phiên khi phát hiện reuse token cũ.
- Bảo vệ CSRF kép (double-submit cookie + header) và kiểm tra Origin/Referer nghiêm ngặt cho toàn bộ browser API.
- Mã hóa dữ liệu nhạy cảm (Zalo session, secret keys, SMTP password) bằng `AES-256-GCM` trước khi lưu vào cơ sở dữ liệu PostgreSQL.
- Chặn tấn công SSRF (`outbound-url-policy.ts`) cho Webhook và tải tệp đính kèm: chặn dải IP riêng tư IPv4/IPv6, kiểm tra DNS và giới hạn tối đa 3 lần redirect.

### 4.3. Khả dụng & Khôi phục (Availability & Disaster Recovery)
- Tự động sao lưu dữ liệu PostgreSQL định kỳ hàng ngày lưu trữ tối đa 7 bản ngày, 4 bản tuần và 3 bản tháng.
- Cơ chế Liveness / Readiness Health Check tại `/health` theo dõi liên tục kết nối cơ sở dữ liệu và tính tương thích của schema migrations.
- Quy trình deploy an toàn (`deploy-compose.mjs`): xác thực graceful drain 70s, ghim image digest và chạy migrator trước khi khởi động phiên bản ứng dụng mới.
