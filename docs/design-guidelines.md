# ZaloCRM — Design Guidelines & UI/UX Standards

Tài liệu này định hình ngôn ngữ thiết kế giao diện (UI) và trải nghiệm người dùng (UX) cho hệ thống **ZaloCRM**. Toàn bộ các trang, bố cục (layouts) và components trên ứng dụng frontend Vue 3 / Vuetify 4 phải tuân thủ nghiêm ngặt các quy chuẩn này nhằm đảm bảo tính thẩm mỹ, nhất quán, tốc độ phản hồi dứt khoát và hiệu suất làm việc bền bỉ cho nhân viên vận hành.

---

## 1. Hệ Thống Thiết Kế Neo-Brutalism (Design System)

ZaloCRM chuyển đổi từ phong cách cũ (Liquid Silicon kính mờ, viền phát sáng) sang phong cách **Neo-Brutalism hiện đại** (kế thừa và tối ưu từ chuẩn thiết kế của hệ thống CQA / ClawTask). Triết lý cốt lõi của Neo-Brutalism trong ZaloCRM là: **Rõ ràng, dứt khoát, hình học thực dụng và triệt tiêu hoàn toàn sự màu mè gây mỏi mắt.**

### 1.1. Bảng Màu Hệ Thống (Color Palette)

Hệ thống hỗ trợ đồng thời hai chế độ **Light Mode** (mặc định cho môi trường văn phòng) và **Dark Mode** (tối ưu làm việc ban đêm / giảm mỏi mắt), sử dụng độ tương phản cao với viền định hình sắc nét:

| Token Màu | Mã Màu (Light Mode) | Mã Màu (Dark Mode) | Ứng dụng & Ý nghĩa Nghiệp vụ |
|-----------|--------------------|-------------------|------------------------------|
| `primary` | `#0068FF` (Zalo Blue) | `#388BFD` (Vivid Blue) | Màu thương hiệu nhận diện Zalo, nút hành động chính (Primary CTA), tab active, viền tin nhắn gửi đi |
| `secondary` | `#EBF3FE` (Icy Pastel Blue) | `#0C2B59` (Deep Navy) | Nền hội thoại active, nền badge phụ, thẻ thông tin mở rộng |
| `background` | `#F5F2EB` (Warm Cream / Retro Paper) | `#121214` (Deep Charcoal Zinc) | Nền toàn bộ ứng dụng, tạo cảm giác giấy in kỹ thuật, giảm căng thẳng thị giác so với trắng gắt |
| `surface` | `#FFFFFF` (Stark White) | `#1F1F23` (Off-black Zinc) | Nền card thẻ, modal dialogs, bảng dữ liệu, thanh sidebar |
| `border` | `#18181B` (Zinc 900) | `#3F3F46` (Zinc 700) | Đường viền cơ học dứt khoát chuẩn 1.5px cho mọi container |
| `text-primary` | `#18181B` (Gần như đen tuyền) | `#F4F4F5` (Zinc 100) | Văn bản chính, tiêu đề, nội dung chat quan trọng |
| `text-secondary` | `#71717A` (Zinc 500) | `#A1A1AA` (Zinc 400) | Thời gian gửi, nhãn phụ, placeholder, trạng thái thứ cấp |
| `success` | `#10B981` (Emerald) | `#22C55E` (Green 500) | Zalo tài khoản Online, đơn hàng hoàn tất, việc xử lý thành công |
| `warning` | `#F59E0B` (Amber) | `#EAB308` (Yellow 500) | Đơn hàng chờ xử lý, phiên đăng nhập sắp hết hạn, cảnh báo |
| `error` | `#EF4444` (Crimson) | `#F43F5E` (Rose 500) | Zalo mất kết nối, lỗi API, đơn hàng đã hủy, nút hành động nguy hiểm |
| `info` | `#3B82F6` (Sky Blue) | `#38BDF8` (Sky 400) | Hướng dẫn hệ thống, thông số kỹ thuật, ghi chú khách hàng |

---

### 1.2. 4 Quy Tắc Cốt Lõi Của Neo-Brutalism

1. **100% Zero Shadow (Triệt tiêu toàn bộ bóng mờ)**:
   - Nghiêm cấm sử dụng `box-shadow` mờ ảo (`box-shadow: none !important;`).
   - Không sử dụng hiệu ứng phát sáng (glow), blur, hay elevation của Material Design 3. Mọi khối nổi bật đều được phân tách bằng màu nền và đường viền thực thụ.

2. **Khung Viền Cơ Học Sắc Nét (Crisp Mechanical Borders)**:
   - Toàn bộ cards, buttons, text fields, tables, dialogs, chat bubbles đều có viền:
     - Light Mode: `border: 1.5px solid #18181B;`
     - Dark Mode: `border: 1.5px solid #3F3F46;`
   - Đường phân cách giữa các panel: `border-right: 1.5px solid #18181B;` / `border-bottom: 1.5px solid #18181B;`.

3. **Phản Hồi Cơ Học (Tactile Press Feedback)**:
   - Các phần tử có thể tương tác (Buttons, clickable cards, list items) phản hồi vật lý khi click:
     ```css
     .v-btn:active, .clickable-card:active {
       transform: translate(1px, 1px) !important;
     }
     ```
   - Tạo cảm giác nhấn công tắc cơ khí dứt khoát, không dùng hiệu ứng phóng to / thu nhỏ đàn hồi.

4. **Bo Góc Hình Học Cao Cấp Chuẩn CQA (Refined Geometric Radii)**:
   - Tham chiếu thiết kế thực tế từ **CQA (Chat-Quality-Agent - `cqa.toantit.com`)**.
   - Chuẩn bán kính góc:
     - Thẻ card, Hộp thoại Dialog, Bảng dữ liệu: `border-radius: 12px;` viền cơ học `1.5px solid #18181B`.
     - Nút bấm (Buttons), Ô nhập liệu (Inputs), Khối Icon (`.neo-icon-box`): `border-radius: 8px;` (`rounded: 'lg'` trong Vuetify 4), viền `1.5px`.
     - Huy hiệu & Trạng thái (Chips/Badges): Dạng viên thuốc (`rounded-pill`, `border-radius: 9999px`), viền `1.5px solid #18181B`, chữ IN HOA.
     - Bong bóng tin nhắn chat: `border-radius: 12px;` viền `1.5px`.
     - Avatar người dùng: Hỗ trợ hình tròn (`rounded-circle`, `border-radius: 50%`) cho Profile và Contact; khối vuông bo 8px viền 1.5px cho Icon box / Logo kênh.

---

### 1.3. Hệ Thống Typography & Utility Classes (Typography System)

Sự kết hợp giữa phông chữ hình học mạnh mẽ cho nhận diện và phông chữ công thái học cho nội dung văn bản dài:

- **Font Tiêu Đề & Số Liệu:** Google Font **Space Grotesk** (`font-family: 'Space Grotesk', sans-serif; font-weight: 700 / 800 / 900`).
  - Dùng cho: Logo thương hiệu, Tiêu đề trang (`h1`, `h2`), Chỉ số thống kê KPI, Nhãn các nút bấm chính, Tên tab.
- **Tiêu Đề Trang Chuẩn CQA (`.neo-page-title`):**
  - Định dạng: Chữ **IN HOA In Nghiêng Đậm (Bold Italic)**, từ khóa chính được highlight màu Xanh Zalo `#0068FF` (`.neo-title-accent`).
  - Ví dụ: `KHÔNG GIAN LÀM VIỆC <span class="neo-title-accent">TỔNG QUAN</span>`.
- **Font Văn Bản & Nội Dung Chat:** Google Font **Plus Jakarta Sans** hoặc **Inter** (`font-weight: 400 / 500 / 600`).
  - Dùng cho: Nội dung tin nhắn hội thoại, danh sách khách hàng, bảng dữ liệu, nội dung báo cáo chi tiết.
- **Lớp Nhãn Kỹ Thuật (`.neo-subtitle`):**
  ```css
  .neo-subtitle {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 800;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
  }
  ```
- **Lớp Badge Viên Thuốc (`.neo-pill`):**
  ```css
  .neo-pill {
    border-radius: 9999px !important;
    border: 1.5px solid var(--border-color) !important;
    text-transform: uppercase;
    font-weight: 700;
    font-size: 0.75rem;
  }
  ```

---

## 2. Bố Cục Ứng Dụng & Trải Nghiệm Đa Màn Hình (Application Shell)

Giao diện được xây dựng trên lưới layout công nghiệp, chia ô rõ ràng với các đường viền phân cách 1.5px.

### 2.1. Thanh Điều Hướng Trên Cùng (Top App Bar)
- Chiều cao cố định `56px`, nền `surface`, viền đáy `1.5px solid var(--border-color)`.
- **Logo ZaloCRM:** Chữ `Zalo` (đen hoặc trắng) ghép với khối `CRM` nền Zalo Blue chữ trắng, viền đen sắc nét.
- **Global Search:** Ô tìm kiếm hình chữ nhật bo nhẹ 4px, viền 1.5px, icon kính lúp, placeholder rõ nét.
- **Trạng Thái Kết Nối Socket / Zalo Engine:**
  - Khối chữ nhật bo 4px viền 1.5px: Chấm tròn phẳng (không phát sáng nhòe) kèm text `ONLINE` / `OFFLINE` font Space Grotesk in hoa.
- **Action Buttons:** Phím chuyển đổi theme Sáng/Tối, chuông thông báo, menu tài khoản nhân viên với phản hồi click cơ học.

### 2.2. Thanh Menu Bên (Navigation Drawer)
- Nền `surface`, viền phải `1.5px solid var(--border-color)`.
- **Menu Items:**
  - Khoảng cách giữa các item gọn gàng, viền bo `4px`.
  - Trạng thái Hover: Đổi màu nền sang xám nhạt (`#E4E4E7` ở Light / `#27272A` ở Dark).
  - Trạng thái Active: Nền `secondary` pastel, có đường viền đen `1.5px` bao quanh và dải màu `primary` dày `3px` ở mép trái.
- **Chân Drawer (User Profile Block):**
  - Thẻ profile người dùng vuông vắn hiển thị Avatar, Tên, Quyền hạn (`ADMIN`, `STAFF`, `LEAD`) và nút Đăng xuất.

---

## 3. Quy Chuẩn Chi Tiết Các Thành Phần Nghiệp Vụ (Business UI Components)

### 3.1. Trạng Thái & Thanh Chọn Đa Tài Khoản Zalo (Multi-Account Rail & Account Indicators)

Hệ thống hỗ trợ quản lý và phân luồng đồng thời nhiều tài khoản Zalo cá nhân/doanh nghiệp:

#### 3.1.1. Thanh Chọn Tài Khoản Zalo Dọc (`AccountRail.vue`)
- **Vị trí & Kích thước:**
  - Desktop: Chiếm cạnh trái ngoài cùng của khu vực làm việc với chiều rộng cố định `64px`, chiều cao `100%`, viền cơ học phải `1.5px solid var(--border-color)`.
  - Mobile / Màn hình hẹp: Dải ngang cuộn mượt ở đầu màn hình với chiều cao cố định `56px`, viền đáy `1.5px solid var(--border-color)`.
- **Nút "TẤT CẢ" (ALL Mode):**
  - Khối vuông bo nhẹ `10px`, chữ `ALL` in hoa font Space Grotesk 800.
  - Cho phép người vận hành xem hộp thư hợp nhất của toàn bộ tài khoản.
  - Tích hợp huy hiệu tổng số tin nhắn chưa đọc (`rail-badge`) dạng viên thuốc đỏ `#EF4444` viền đen 1.5px.
- **Nút Tài Khoản Riêng Biệt:**
  - Khối Avatar đại diện `44x44px`, bo góc `10px`, bao viền cơ học `2px solid transparent` (chuyển viền đen `2px solid #18181B` khi active).
  - Tự động hiển thị ảnh đại diện Zalo (`avatarUrl`) hoặc Monogram 2 ký tự viết tắt nếu chưa có ảnh.
  - **Chấm trạng thái kết nối (Status Indicator):** Chấm tròn phẳng `10px` ở góc dưới phải: Xanh lục `#10B981` khi `ONLINE`, Xám viền đen khi `OFFLINE`.
  - **Huy hiệu tin chưa đọc cá nhân:** Hiển thị số đếm chưa đọc (tối đa `99+`) trên góc trên phải avatar.
- **Rich Tooltip Neo-Brutalism:**
  - Khi hover/focus: Hiển thị Tooltip viền đen phẳng không bóng mờ, bao gồm Tên tài khoản, Số điện thoại, Trạng thái online, và **Nhãn chi nhánh (`branchTag`)** nổi bật.

#### 3.1.2. Bảng Màu Nhận Diện Tài Khoản & Nhãn Chi Nhánh (`account-colors.ts`)
Nhằm giúp nhân viên phân biệt tức thì tin nhắn đến từ tài khoản hay chi nhánh nào mà không nhầm lẫn, ZaloCRM trang bị bảng màu **Neo-Brutalism Palette gồm 12 sắc thái tương phản cao**:

| Mã Sắc Thái | Giá Trị Hex | Tên Định Danh | Ứng dụng gợi ý |
|-------------|------------|---------------|----------------|
| `0` | `#0068FF` | Zalo Blue | Tài khoản CSKH Chính |
| `1` | `#10B981` | Emerald Green | Chi nhánh Miền Bắc / Kế toán |
| `2` | `#F59E0B` | Amber Yellow | Chi nhánh Miền Nam / Telesales |
| `3` | `#EF4444` | Crimson Red | Kênh Xử lý Sự cố / VIP |
| `4` | `#8B5CF6` | Vivid Purple | Chi nhánh Miền Trung / Kho vận |
| `5` | `#EC4899` | Neon Pink | Kênh Marketing / Sự kiện |
| `6` | `#06B6D4` | Bright Cyan | Kênh Tư vấn Dự án |
| `7` | `#14B8A6` | Teal | Kênh Hợp đồng / Bán buôn |
| `8` | `#F97316` | Bright Orange | Showroom Trưng bày |
| `9` | `#6366F1` | Indigo | Kỹ thuật / Bảo hành |
| `10` | `#84CC16` | Fresh Lime | Tuyển dụng / Nội bộ |
| `11` | `#D946EF` | Fuchsia | Đại lý / Đối tác cấp 1 |

- **Thuật toán màu tiền định (`getDeterministicAccountColor`):** Nếu tài khoản chưa gán mã màu riêng `colorTag`, hệ thống tự động băm (hash) `accountId` thành một trong 12 mã màu trên, đảm bảo tính ổn định thị giác xuyên suốt phiên làm việc.
- **Tạo Monogram 2 ký tự tự động (`getAccountMonogram`):**
  - Ưu tiên 1: Lấy 2 chữ cái đầu của `branchTag` (Ví dụ: "Hà Nội" -> "HN", "Sài Gòn" -> "SG").
  - Ưu tiên 2: Lấy 2 chữ cái đầu của `displayName` (Ví dụ: "Nguyễn Văn" -> "NV").
  - Ưu tiên 3: Lấy 2 số cuối của số điện thoại `phone`.
  - Dự phòng: Lấy 2 ký tự đầu của `zaloUid` hoặc mặc định "ZL".
- **Tính toán tương phản chữ (`getContrastTextColor`):** Tự động tính độ chói quang học (luminance). Nếu màu nền sáng (> 0.65) dùng chữ đen `#111827`, ngược lại dùng chữ trắng tuyền `#FFFFFF`.

---

### 3.2. Không Gian Chat Real-time 3 Cột (Neo-Brutalism Chat Interface)

Không gian chat chiếm toàn bộ chiều cao màn hình (`calc(100vh - 56px)`), gồm 3 phân vùng có thể co giãn kích thước:

1. **Cột Danh Sách Hội Thoại (Conversation List - Trái):**
   - Nền `surface`, viền phải `1.5px solid var(--border-color)`.
   - Đầu cột: Thanh lọc tài khoản Zalo (Account Dropdown) và ô tìm kiếm khách hàng viền 1.5px.
   - Thẻ hội thoại:
     - Thẻ thông thường: Nền phẳng, phân tách bằng đường kẻ `1px solid var(--border-subtle)`.
     - Thẻ hội thoại đang chọn (`.conversation-active`): Nền `#EBF3FE` (Light) / `#0C2B59` (Dark), viền `1.5px solid #18181B`, chữ đậm.
     - Badge tin nhắn chưa đọc: Hình chữ nhật nhỏ bo 4px, nền đỏ `#EF4444`, chữ trắng đậm, viền đen 1px, không bóng mờ.

2. **Cột Khung Chat Chính (Message Thread - Giữa):**
   - Nền khu vực tin nhắn: `#F5F2EB` (Warm Cream ở Light) / `#121214` (Dark).
   - **Bong bóng tin nhắn của Nhân viên (Self / Staff - Căn phải):**
     - Nền: `primary` (`#0068FF` ở Light / `#388BFD` ở Dark).
     - Chữ: Trắng `#FFFFFF`, sắc nét, dễ đọc.
     - Viền: `1.5px solid #18181B` (Light) hoặc `1.5px solid #000000` (Dark).
     - Bo góc: `12px` (chuẩn `rounded-xl` CQA, không bo tròn viên thuốc).
     - Thời gian tin nhắn: Trắng mờ `rgba(255, 255, 255, 0.75)`, đặt góc dưới.
   - **Bong bóng tin nhắn của Khách hàng (Contact - Căn trái):**
     - Nền: `#FFFFFF` (Light) / `#1F1F23` (Dark).
     - Chữ: `#18181B` (Light) / `#F4F4F5` (Dark).
     - Viền: `1.5px solid #18181B` (Light) / `1.5px solid #3F3F46` (Dark).
     - Bo góc: `12px` (chuẩn `rounded-xl` CQA).
     - Thời gian tin nhắn: `#71717A` (Light) / `#A1A1AA` (Dark).
   - **Đính kèm Tệp tin & Ảnh:**
     - Ảnh gửi/nhận: Bo viền `1.5px solid #18181B`, bo góc `8px`, xem ảnh mở modal Neo-Brutalism.
     - File thẻ (`file-card`): Khối chữ nhật nền trắng, icon tài liệu, nút tải về dạng phím cơ học.
   - **Thanh Nhập Tin Nhắn (Chat Input Area):**
     - Viền trên `1.5px solid var(--border-color)`.
     - Ô soạn thảo phẳng, viền 1.5px. Nút Gửi (`Send Button`): Màu `primary`, viền đen, icon mũi tên đậm.

3. **Cột Thông Tin Khách Hàng (Contact & Order Panel - Phải):**
   - Viền trái `1.5px solid var(--border-color)`.
   - Hiển thị thông tin liên hệ, danh sách đơn hàng đã đặt, các lịch hẹn sắp tới.
   - Các nút "Tạo đơn hàng", "Đặt lịch hẹn" mang phong cách phím bấm cơ học.

---

### 3.3. Huy Hiệu Trạng Thái Đơn Hàng (Order Status Badges)

Được thiết kế dạng nhãn phẳng với viền đen `1.5px`, góc bo `4px`, chữ hoa font Space Grotesk:

| Mã Trạng Thái | Tên Trạng Thái | Màu Nền (Pastel Flat) | Màu Chữ / Viền |
|---------------|----------------|----------------------|----------------|
| `new` | Mới tạo | `#E0F2FE` (Sky 100) | `#0369A1` / `#18181B` |
| `confirmed` | Đã xác nhận | `#CFFAFE` (Cyan 100) | `#0E7490` / `#18181B` |
| `paid` | Đã thanh toán | `#DCFCE7` (Green 100) | `#15803D` / `#18181B` |
| `shipped` | Đang giao hàng | `#F3E8FF` (Purple 100) | `#7E22CE` / `#18181B` |
| `completed` | Hoàn tất | `#D1FAE5` (Emerald 100) | `#047857` / `#18181B` |
| `cancelled` | Đã hủy | `#F4F4F5` (Zinc 100) | `#71717A` / `#18181B` |

---

### 3.4. Báo Cáo Phân Tích & Bảng Tin AI (AI Reports & Digest)

- **Thẻ Chỉ Số KPI (KPI Cards):**
  - Khung viền `1.5px solid var(--border-color)`, bo góc `12px`.
  - Giá trị số liệu lớn: Font **Space Grotesk 900**, kích thước từ `2rem` đến `2.5rem`.
  - Nhãn danh mục: Class `.neo-subtitle`.
  - Tỷ lệ tăng trưởng: Chip hình chữ nhật xanh lá/đỏ viền đen dứt khoát.
- **Trạng Thái Xử Lý AI Job (AI Job Chips):**
  - `queued`: Nền vàng pastel, icon đồng hồ, viền đen.
  - `running`: Nền xanh dương pastel, tiến trình `v-progress-linear` phẳng không glow, viền đen.
  - `completed`: Nền xanh lá pastel, icon tích hoàn thành, viền đen.
  - `failed`: Nền đỏ pastel, icon lỗi, viền đen.
- **Văn Bản Markdown Khử Khuẩn (Sanitized AI Digest):**
  - Toàn bộ nội dung báo cáo AI được khử khuẩn qua `DOMPurify` trước khi render để chống triệt để Stored XSS.
  - Các khối trích dẫn (`blockquote`) và đoạn code trong báo cáo AI có nền tương phản và đường viền trái dày `3px solid #0068FF`.

---

### 3.5. Hệ Thống Icon Nhận Diện Tùy Chỉnh (Custom SVG Icons & AI Brand Icons)

Thay vì dùng font icon nhòe nét, ZaloCRM tích hợp bộ icon vector phẳng qua plugin `custom-icons.ts`:
- **Cơ chế nạp tự động (Eager Glob):** Toàn bộ file `.svg` trong `public/icons/` được nạp sẵn khi build, tự động chuẩn hóa thuộc tính `fill="currentColor"` và class `v-icon__svg`.
- **41 Ánh xạ MDI sang SVG:** Tự động chuyển đổi các class icon quen thuộc như `mdi-view-dashboard-outline`, `mdi-message-text-outline`, `mdi-robot-outline` sang tệp SVG vector tương ứng.
- **Icon Thương hiệu Nhà Cung Cấp AI:**
  - `gemini.svg`: Logo Google Gemini cho các tác vụ Multimodal Vision.
  - `openai.svg`: Logo OpenAI cho các model GPT-4o / GPT-4o-mini.
  - `deepseek.svg`: Logo DeepSeek cho các tác vụ suy luận phân tích chi phí thấp.
  - `ai.svg` / `auto.svg`: Biểu tượng vi mạch phẳng cho Custom OpenAI-Compatible Local Gateway.

---

### 3.6. Giao Diện Nhiệm Vụ Hành Động & Phát Tin Zalo (Action Items Checklist & Broadcast Modal)

- **Thẻ Nhiệm Vụ Hành Động (Action Item Card):**
  - Hiển thị bên dưới bản phân tích tổng quan của AI Report, bo góc `12px`, viền `1.5px solid var(--border-color)`.
  - Mỗi nhiệm vụ là một dòng tương tác gồm Checkbox trạng thái, Tiêu đề nhiệm vụ, Người phụ trách (`assignee`), và Hạn chót (`deadline`).
  - **Huy hiệu mức độ ưu tiên (`priority`):**
    - `high`: Chip viên thuốc nền đỏ pastel `#FEE2E2`, chữ đỏ `#DC2626`, viền đen `1.5px`.
    - `medium`: Chip viên thuốc nền vàng pastel `#FEF3C7`, chữ cam `#D97706`, viền đen `1.5px`.
    - `low`: Chip viên thuốc nền xám pastel `#F4F4F5`, chữ xám chì `#4B5563`, viền đen `1.5px`.
  - **Cập nhật trạng thái tức thì:** Nhân viên có thể tích chọn hoàn thành trực tiếp trên bảng điều khiển, dữ liệu đồng bộ qua `PUT /api/v1/ai-reports/:id/tasks/:taskId`.
- **Hộp Thoại Phát Tin Nhóm Zalo (Broadcast Tasks Dialog):**
  - Mở qua nút bấm cơ học `[PHÁT TIN ZALO]`.
  - Cho phép người vận hành chọn Tài khoản Zalo phát tin, Nhóm Zalo đích tiếp nhận, và xem trước định dạng tin nhắn văn bản trước khi gửi.
  - Sau khi phát tin thành công, hệ thống hiển thị mã tin nhắn Zalo và thời gian phát sóng xác nhận.

---

## 4. Cấu Hình Vuetify 4 (Vuetify Setup & Token Mapping)

Để đảm bảo toàn bộ components Vuetify tự động thừa hưởng phong cách Neo-Brutalism mà không phải ghi đè CSS thủ công ở từng file Vue:

```typescript
// frontend/src/plugins/vuetify.ts
export const vuetify = createVuetify({
  theme: {
    defaultTheme: localStorage.getItem('theme') || 'light',
    themes: {
      light: {
        dark: false,
        colors: {
          background: '#F5F2EB',
          surface: '#FFFFFF',
          'surface-variant': '#E8E5DE',
          primary: '#0068FF',
          secondary: '#EBF3FE',
          border: '#18181B',
          error: '#EF4444',
          warning: '#F59E0B',
          success: '#10B981',
          info: '#3B82F6',
          'on-background': '#18181B',
          'on-surface': '#18181B',
          'on-primary': '#FFFFFF',
        },
      },
      dark: {
        dark: true,
        colors: {
          background: '#121214',
          surface: '#1F1F23',
          'surface-variant': '#27272A',
          primary: '#388BFD',
          secondary: '#0C2B59',
          border: '#3F3F46',
          error: '#F43F5E',
          warning: '#EAB308',
          success: '#22C55E',
          info: '#38BDF8',
          'on-background': '#F4F4F5',
          'on-surface': '#F4F4F5',
          'on-primary': '#FFFFFF',
        },
      },
    },
  },
  defaults: {
    VBtn: {
      variant: 'flat',
      rounded: 'lg', // 8px border-radius chuẩn CQA
      elevation: 0,
    },
    VCard: {
      variant: 'flat',
      elevation: 0, // Bán kính 12px thừa hưởng qua var(--radius-card)
    },
    VTextField: {
      variant: 'outlined',
      density: 'compact',
      rounded: 'lg', // 8px
    },
    VSelect: {
      variant: 'outlined',
      density: 'compact',
      rounded: 'lg', // 8px
    },
    VAutocomplete: {
      variant: 'outlined',
      density: 'compact',
      rounded: 'lg', // 8px
    },
    VTextarea: {
      variant: 'outlined',
      density: 'compact',
      rounded: 'lg', // 8px
    },
    VChip: {
      rounded: 'pill', // 9999px viên thuốc chuẩn CQA
      size: 'small',
      elevation: 0,
    },
    VAvatar: {
      rounded: 'circle', // Tròn cho profile & contact, ngoại trừ icon box vuông
    },
    VDialog: {
      maxWidth: 600,
      elevation: 0,
    },
    VDataTable: {
      elevation: 0,
    },
  },
});
```

---

## 5. Tương Tác & Trạng Thái Phản Hồi (Interactions & Feedback)

1. **Khung Giữ Chỗ Khi Tải Dữ Liệu (Skeleton Loaders):**
   - Sử dụng `v-skeleton-loader` với góc bo `8px`, không hiệu ứng sóng lượn bóng nhờn, giữ ổn định layout khi tải danh sách cuộc trò chuyện.
2. **Thông Báo Toasts & Alerts:**
   - Hiển thị góc trên bên phải, viền `1.5px solid #18181B`, bo góc `8px`, nền phẳng chuẩn mã màu trạng thái, chữ đậm rõ ràng.
3. **Hộp Thoại Xác Nhận Thao Tác Nguy Hiểm (Confirm Dialogs):**
   - Xóa tài khoản Zalo, thu hồi tin nhắn, hủy đơn hàng bắt buộc phải mở Hộp thoại Xác nhận.
   - Nút hành động mang màu đỏ (`color="error"`), viền đen `1.5px`, bo góc `8px`, bấm có phản hồi cơ học.

---

## 6. Những Quy Tắc Tuyệt Đối Cấm (Forbidden Design Tropes)

- ❌ **Cấm Bóng Mờ (No Box Shadows):** Tuyệt đối không dùng `box-shadow` hay `drop-shadow` làm mờ ranh giới phần tử.
- ❌ **Cấm Hiệu Ứng Thủy Tinh (No Glassmorphism):** Loại bỏ toàn bộ `backdrop-filter: blur(...)` và nền trong suốt nhiều lớp gây giảm hiệu năng render GPU.
- ❌ **Cấm Viền Phát Sáng & Gradient Nhòe (No Glow & Blurry Halos):** Không dùng viền phát sáng cyan/neon hay animation bồng bềnh (`ai-core-orb`, `liquid-morph`, `flow-bg`).
- ❌ **Cấm Lạm Dụng Bo Tròn Viên Thuốc Sai Vị Trí (No Over-rounded Containers):** Không dùng `rounded="pill"` trên các khối Card, Container, Bảng dữ liệu hoặc Khung Chat (Cards luôn giữ `12px`, Chat bubble `12px`, Buttons/Inputs `8px`; chỉ dùng `rounded="pill"` cho Chips/Badges trạng thái).
- ❌ **Cấm Màu Tím Lòe Loẹt Trên Nền Tối:** Duy trì bảng màu có độ tương phản đạt chuẩn WCAG AA/AAA cho các ca trực hỗ trợ khách hàng kéo dài.
- ❌ **Cấm Lưu Token Bảo Mật Trong localStorage:** Tuân thủ quy chuẩn bảo mật Cookie `httpOnly` và sanitization dữ liệu DOMPurify.

