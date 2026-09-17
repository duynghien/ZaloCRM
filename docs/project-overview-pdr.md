# ZaloCRM — Project Overview & Product Requirements Document (PRD)

## 1. Executive Summary

**ZaloCRM** là hệ thống quản lý tập trung nhiều tài khoản Zalo cá nhân dành cho doanh nghiệp, chuỗi chi nhánh, đội ngũ bán hàng và hỗ trợ khách hàng. Hệ thống hỗ trợ tương tác trò chuyện real-time với thanh điều hướng đa tài khoản (Account Rail), quản lý khách hàng theo đường ống bán hàng (Pipeline), đặt và nhắc lịch hẹn tự động, báo cáo thống kê hiệu suất làm việc, phân hệ Báo cáo Điều hành AI Đa Nhà Cung Cấp (Multi-Provider AI Digest & Failover), quy tắc thẩm định nhóm tự động (AI Group Audit Rules), cùng hệ thống API công khai và Webhook hỗ trợ tích hợp với các hệ thống bên ngoài.

---

## 2. Tầm Nhìn & Mục Tiêu (Vision & Objectives)

### 2.1. Tầm nhìn
Trở thành giải pháp CRM Zalo mượt mà, an toàn, thông minh và dễ triển khai nhất dành cho các doanh nghiệp vừa và nhỏ (SME) và chuỗi chi nhánh tại Việt Nam, giúp tối ưu hóa quy trình chăm sóc khách hàng và gia tăng tỷ lệ chuyển đổi đơn hàng qua Zalo.

### 2.2. Mục tiêu kỹ thuật & kinh doanh
- **Quản lý đa tài khoản & phân chia chi nhánh:** Đăng nhập và duy trì đồng thời nhiều tài khoản Zalo cá nhân trên một giao diện Web duy nhất, hỗ trợ gán thẻ chi nhánh (`branchTag`) và mã màu nhận diện (`colorTag`) mà không bị trùng lặp hay xung đột phiên.
- **Phản hồi tức thì & Đồng bộ đa thiết bị:** Đồng bộ tin nhắn hai chiều giữa Zalo và CRM dưới 1 giây qua WebSocket (Socket.IO). Tự động thu thập tin nhắn nhân viên gửi từ điện thoại/iPad ngoài (`selfListen: true`) và tự lành thông tin danh bạ.
- **An toàn & Chống khóa tài khoản:** Tự động giới hạn tốc độ gửi tin (Rate Limiting 2 tầng: hạn mức ngày 200 tin và nhịp burst tương tác 3 tin/30s), chia nhỏ luồng gửi tin và lưu trữ thông tin phiên làm việc an toàn với AES-256-GCM.
- **Trí tuệ nhân tạo linh hoạt (Multi-Provider AI):** Tự do lựa chọn hoặc kết hợp các nhà cung cấp AI hàng đầu (Google Gemini, OpenAI, DeepSeek, Local AI Gateway) với cơ chế tự động chuyển vùng dự phòng (failover) và trích xuất hình ảnh thông minh (Multimodal Burst Sampling).
- **Dễ dàng Triển khai & Bảo trì:** Đóng gói toàn bộ ứng dụng bằng Docker Compose, quy trình triển khai 1-click an toàn (`deploy-compose.mjs`) có kiểm soát drain và migration độc lập.

---

## 3. Phạm Vi Tính Năng (Feature Scope)

### 3.1. Phân hệ Quản lý Tài khoản Zalo (Zalo Account Management)
- **Đăng nhập QR Code:** Tạo mã QR đăng nhập trực quan, tự động cập nhật trạng thái khi quét thành công.
- **Lưu & Tự khôi phục phiên:** Mã hóa dữ liệu session (cookie, IMEI, userAgent) bằng thuật toán AES-256-GCM. Tự động kết nối lại khi mất mạng hoặc khởi động lại ứng dụng có giãn cách (stagger 10s) chống nghẽn.
- **Thẻ Chi Nhánh & Mã Màu Nhận Diện (Branch & Color Tags):** Hỗ trợ gán nhãn chi nhánh (`branchTag`, ví dụ: *Chi nhánh 1*, *Quận 1*) và chọn mã màu đại diện (`colorTag` gồm 12 mã màu tuyển chọn: Blue, Emerald, Violet, Amber, Rose, Cyan, Orange, Slate, Indigo, Teal, Fuchsia, Lime) giúp nhân viên nhận diện tức thì tài khoản đang thao tác.
- **Giới hạn an toàn & Kiểm tra kết nối:** Theo dõi trạng thái live của từng tài khoản, cấu hình hạn mức an toàn trong ngày và chủ động ngắt kết nối/xóa tài khoản khi cần thiết.

### 3.2. Phân hệ Trò chuyện Real-time & Trợ Lý Copilot (Live Chat, Account Rail & Copilot)
- **Thanh trượt đa tài khoản dọc (Account Rail):** Thanh điều hướng chuyên dụng ở mép trái khu vực chat (`AccountRail.vue`), hiển thị avatar có viền màu tương ứng, badge đếm tin nhắn chưa đọc tổng hợp theo tài khoản và nhãn chi nhánh, hỗ trợ chuyển đổi tức thì giữa các tài khoản Zalo chỉ với 1 click.
- **Trợ lý Hội thoại Copilot (Conversational AI Copilot):** Tích hợp trực tiếp trong luồng chat với cơ chế kích hoạt chủ động (On-Demand) hoặc tự động khi phát hiện ý định khách hàng. Đề xuất câu trả lời gợi ý kèm 1-click áp dụng, tự động bóc tách thông tin khách hàng, đơn hàng hoặc lịch hẹn để điền sẵn vào form tạo mới, và phát hiện bất thường/khiếu nại để cảnh báo nhân viên xử lý kịp thời.
- **Tin nhắn đa phương tiện hai chiều & Khay chờ (Media Staging & Two-Way Messaging):** Hỗ trợ kéo thả, dán ảnh trực tiếp từ Clipboard (`Ctrl+V`) hoặc chọn tệp qua file picker. Hiển thị khay chờ tệp đính kèm (`StagedMediaBar.vue`) cho phép xem trước thumbnail, xóa từng tệp hoặc xóa toàn bộ trước khi gửi kèm tin nhắn văn bản. Hộp thoại phóng to ảnh (`MediaLightboxDialog.vue`) thiết kế phẳng 100% Zero Shadow chuẩn CQA Neo-Brutalism. Luồng gửi media Zalo bảo vệ qua vé streaming HMAC ngắn hạn (60s).
- **Đồng bộ tin nhắn từ thiết bị ngoài (Self-Listen Sync):** Lắng nghe và đồng bộ real-time tin nhắn nhân viên gửi từ điện thoại hoặc iPad cá nhân (`isSelf: true`), gán đúng người gửi `self` và ghi nhận vào doanh số/thống kê mà không làm kẹt nhịp gửi trên Dashboard.
- **Tự lành hội thoại & Danh bạ (Self-Healing Contacts):** Tự động liên kết các cuộc trò chuyện chưa có liên hệ (`contactId: null`) vào bảng Contact khi nhận tin nhắn mới; tự động cập nhật tên thật từ Zalo nếu trước đó là tên mặc định.
- **Thu hồi tin nhắn:** Hỗ trợ thu hồi tin nhắn an toàn theo thread (`undo`) trên cả CRM lẫn đồng bộ Zalo.
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

### 3.6. Phân hệ Báo cáo Điều hành AI Đa Nhà Cung Cấp (Multi-Provider AI Digest & Failover)
- **Kiến trúc Đa Nhà Cung Cấp (Multi-Provider Engine):** Hỗ trợ linh hoạt các nhà cung cấp: **Google Gemini** (Gemini 2.5/3.0 Flash & Pro), **OpenAI** (GPT-4o, GPT-4o-mini), **DeepSeek** (DeepSeek-V3, DeepSeek-R1) và **Custom AI Gateway** (Ollama, vLLM, OpenRouter).
- **Tự động Chuyển Vùng Dự Phòng (Failover Chain):** Cấu hình chuỗi dự phòng thông minh (ví dụ: Gemini → OpenAI → DeepSeek). Khi nhà cung cấp chính gặp sự cố (quá tải, lỗi rate limit 429 hoặc timeout), hệ thống tự động chuyển sang provider tiếp theo trong chuỗi.
- **Single-Layer Budget Reservation:** Tái sử dụng cùng một `attemptKey` xuyên suốt chuỗi failover; token budget chỉ hoàn tất một lần duy nhất khi có provider thành công, loại bỏ hoàn toàn nguy cơ hao hụt ngân sách ảo.
- **Dynamic Model Discovery & Connection Test:** Tự động dò tìm danh sách các mô hình khả dụng tương ứng với API Key và kiểm tra độ trễ kết nối trực tiếp từ giao diện cài đặt (`POST /api/v1/ai-reports/settings/models`, `POST /api/v1/ai-reports/settings/test-ai`).
- **Cầu nối Thị Giác Lai (Smart Hybrid Vision Bridge):** Với các mô hình thuần văn bản (DeepSeek), hệ thống tự động điều phối hình ảnh qua provider thị giác hỗ trợ OCR để trích xuất văn bản hoặc chèn placeholder mô tả thay vì làm gián đoạn tiến trình.
- **Multimodal Burst Sampling & Lấy mẫu ảnh thông minh:**
  - Khử trùng lặp ảnh ứng viên theo Base URL (`dedupCandidatesByBaseUrl`).
  - Lọc khử Prompt Injection đối với ngữ cảnh văn bản đi kèm trước mỗi ảnh.
  - Chiến lược Burst Sampling: Lấy mẫu 100% nếu số lượng ảnh <= 3; tự động lấy mẫu đại diện [ảnh đầu, ảnh giữa, ảnh cuối] nếu cụm ảnh > 3 ảnh.
  - Pool 4 worker xử lý đồng thời, có cache chống va chạm (anti-collision) và trần tổng dung lượng ảnh 12MB.
- **Kiểm chứng chéo 2 tầng & Phát sóng Nhiệm vụ (Two-Tier Cross-Verification & Action Items):**
  - **Tier 1 (Section 6 Directive):** Chỉ thị bắt buộc LLM đối soát chéo giữa các báo cáo văn bản của nhân sự và bằng chứng hình ảnh thực tế đính kèm (phát hiện báo cáo khống, ảnh chụp màn hình cũ).
  - **Tier 2 (High Priority Action Items):** Tự động bóc tách danh sách việc cần làm (`report-action-item-parser.ts`), theo dõi trạng thái hoàn thành (`PUT /api/v1/ai-reports/:id/tasks/:taskId`) và hỗ trợ phát sóng danh sách việc ưu tiên cao tới nhóm Zalo hoặc đích gửi chỉ định (`POST /api/v1/ai-reports/:id/broadcast-tasks`).

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

### 3.10. Phân hệ Theo Dõi & Quản Lý Chi Phí AI (AI Telemetry & Cost Analytics)
- **Thu thập Telemetry tự động:** Mọi tác vụ sử dụng LLM/Vision (Copilot, Báo cáo điều hành, Thẩm định quy tắc nhóm, Kiểm tra kết nối AI) đều được tự động đo lường và lưu trữ chi tiết: số token input, output, cached, thời gian phản hồi (latency), model và provider.
- **Bảng định giá chi tiết & Quy đổi tiền tệ:** Tích hợp danh mục giá chuẩn (`ai-pricing-catalog.ts`) tính toán chi phí chính xác đến từng micro-USD và quy đổi ra VNĐ theo tỷ giá cố định/cấu hình.
- **Tổng hợp dữ liệu nguyên tử (Atomic Daily Rollup):** Dữ liệu được cộng dồn theo ngày vào bảng `daily_ai_usage_stats` sử dụng truy vấn SQL nguyên tử `INSERT ... ON CONFLICT DO UPDATE`, đảm bảo hiệu năng cao và loại trừ hoàn toàn tình trạng race condition.
- **Trực quan hóa & Báo cáo quản trị:**
  - **Thẻ KPI Chi phí AI (`AiCostKpiCard.vue`):** Hiển thị tổng chi phí tháng hiện tại, tỷ lệ tăng giảm so với tháng trước và cảnh báo ngân sách trực tiếp trên Dashboard.
  - **Báo cáo sử dụng chi tiết (`AiUsageReportTab.vue`):** Biểu đồ phân bổ chi phí theo mô hình AI và tính năng nghiệp vụ, bảng kê chi tiết lượt gọi API có phân trang và bộ lọc theo khoảng thời gian.
  - **Xuất dữ liệu Excel:** Hỗ trợ xuất toàn bộ dữ liệu thống kê ra file Excel `.xlsx` phục vụ công tác đối soát kế toán và lập kế hoạch ngân sách (`GET /api/v1/reports/export?type=ai-usage`).

---

## 4. Yêu Cầu Phi Chức Năng (Non-Functional Requirements)

### 4.1. Hiệu năng (Performance)
- Thời gian phản hồi API < 200ms đối với 95% các yêu cầu thông thường.
- Hỗ trợ tối thiểu 50 cuộc hội thoại Zalo hoạt động đồng thời trên VPS cấu hình 2 vCPU / 4GB RAM.
- Hàng đợi Socket.IO đệm tối đa 100 sự kiện/account, tự động gửi tín hiệu resync khi tràn.

### 4.2. Giao diện & Trải nghiệm Người Dùng (UI/UX Neo-Brutalism CQA Standard)
- Thiết kế theo phong cách **Neo-Brutalism hiện đại chuẩn CQA**: 100% Zero Shadow (triệt tiêu hoàn toàn bóng mờ ảo), đường viền cơ học 1.5px dứt khoát, phản hồi click cơ học (`translate(1px, 1px)`).
- Chuẩn bán kính bo góc: 12px cho cards/dialogs/tables và chat bubbles, 8px cho buttons/inputs/icon-boxes, 9999px cho status chips/badges dạng viên thuốc (`.neo-pill`).
- Hệ thống Typography: Font Space Grotesk (700/800/900) cho tiêu đề trang (`.neo-page-title` in hoa nghiêng đậm), nhãn nút và chỉ số KPI; font Plus Jakarta Sans / Inter cho nội dung văn bản và hội thoại.
- Hệ thống biểu tượng: Thư viện Custom SVG Icons độc lập và Brand SVG Icons chính hãng cho các AI provider (Gemini, OpenAI, DeepSeek, Gateway).

### 4.3. Bảo mật (Security)
- Mật khẩu người dùng được băm bằng thuật toán `bcryptjs` với salt round 12.
- Access token JWT ngắn hạn (15 phút) lưu hoàn toàn trong bộ nhớ RAM trình duyệt (`session.ts`), không ghi vào `localStorage` hay `sessionStorage`.
- Refresh token dạng opaque lưu SHA-256 digest trong bảng `auth_sessions`, xoay vòng phiên khi cấp token mới (single-use rotation), tự động thu hồi toàn bộ phiên khi phát hiện reuse token cũ.
- Bảo vệ CSRF kép (double-submit cookie + header) và kiểm tra Origin/Referer nghiêm ngặt cho toàn bộ browser API.
- Mã hóa dữ liệu nhạy cảm (Zalo session, secret keys, AI API keys, SMTP password) bằng `AES-256-GCM` trước khi lưu vào cơ sở dữ liệu PostgreSQL.
- Chặn tấn công SSRF (`outbound-url-policy.ts` và `ai-gateway-validator.ts`): chặn dải IP riêng tư IPv4/IPv6, kiểm tra DNS và giới hạn tối đa 3 lần redirect; yêu cầu cờ `ALLOW_PRIVATE_AI_GATEWAYS=true` nếu kết nối tới AI gateway mạng nội bộ (Ollama, vLLM).

### 4.4. Khả dụng & Khôi phục (Availability & Disaster Recovery)
- Tự động sao lưu dữ liệu PostgreSQL định kỳ hàng ngày lưu trữ tối đa 7 bản ngày, 4 bản tuần và 3 bản tháng.
- Cơ chế Liveness / Readiness Health Check tại `/health` theo dõi liên tục kết nối cơ sở dữ liệu và tính tương thích của schema migrations.
- Quy trình deploy an toàn (`deploy-compose.mjs`): xác thực graceful drain 70s, ghim image digest và chạy migrator trước khi khởi động phiên bản ứng dụng mới.
