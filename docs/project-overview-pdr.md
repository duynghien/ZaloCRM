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
- **Quản lý Đơn hàng:** Tạo và theo dõi đơn hàng gắn liền với từng khách hàng và cuộc trò chuyện.

### 3.4. Phân hệ Lịch hẹn & Nhắc nhở (Appointments)
- **Quản lý lịch hẹn:** Đặt lịch hẹn làm việc, tư vấn hoặc khám bệnh với khách hàng.
- **Tự động nhắc lịch:** Tiến trình chạy ẩn (Cron Job) tự động kiểm tra và gửi thông báo nhắc lịch hẹn sắp tới qua Socket.IO và Zalo.

### 3.5. Phân hệ Quản trị & Phân quyền (RBAC & Team Management)
- **Tổ chức (Organization):** Mô hình Multi-Tenant, dữ liệu của mỗi tổ chức được cô lập hoàn toàn.
- **Vai trò người dùng:**
  - `Owner`: Quyền cao nhất, quản lý thanh toán, tổ chức và toàn bộ hệ thống.
  - `Admin`: Quản lý nhân sự, danh mục, cấu hình Zalo và báo cáo.
  - `Member`: Xem toàn bộ contact trong organization; chỉ truy cập hội thoại và tài khoản Zalo được cấp qua `ZaloAccountAccess`.
- **AI Reports:** Cả `owner`, `admin` và `member` đều được sử dụng. Owner/admin có phạm vi toàn organization; member chỉ đọc/generate/resend dữ liệu từ Zalo account nằm trong ACL của mình. Cấu hình cấp organization như SMTP và lịch tự động chỉ owner/admin được thay đổi.

### 3.6. Phân hệ Tích hợp API & Webhook
- **Public REST API:** Cung cấp các endpoint RESTful được xác thực bằng `X-API-Key` cho phép hệ thống bên ngoài tạo/lấy danh sách khách hàng, lịch hẹn, gửi tin nhắn.
- **Webhook Subscriptions:** Đăng ký nhận sự kiện real-time: `message.received`, `message.sent`, `contact.created`, `zalo.connected`, `zalo.disconnected`.

---

## 4. Yêu Cầu Phi Chức Năng (Non-Functional Requirements)

### 4.1. Hiệu năng (Performance)
- Thời gian phản hồi API < 200ms đối với 95% các yêu cầu.
- Hỗ trợ tối thiểu 50 cuộc hội thoại Zalo hoạt động đồng thời trên VPS cấu hình 2 vCPU / 4GB RAM.

### 4.2. Bảo mật (Security)
- Toàn bộ mật khẩu người dùng được băm bằng thuật toán `bcryptjs` (salt round 10).
- Mã hóa dữ liệu nhạy cảm (Zalo session, secret keys) bằng `AES-256-GCM` trước khi lưu vào cơ sở dữ liệu PostgreSQL.
- Xác thực truy cập bằng JSON Web Token (JWT) ngắn hạn và API Keys mã hóa.

### 4.3. Kha dụng & Khôi phục (Availability & Disaster Recovery)
- Tự động sao lưu dữ liệu PostgreSQL định kỳ hàng ngày lưu trữ tối đa 7 bản ngày, 4 bản tuần và 3 bản tháng.
- Cơ chế Liveness / Readiness Health Check tại `/health` theo dõi liên tục kết nối cơ sở dữ liệu.
