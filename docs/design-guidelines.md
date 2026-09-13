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

4. **Bo Góc Hình Học Tối Giản (Compact Geometric Radii)**:
   - Loại bỏ hoàn toàn kiểu bo góc tròn hình viên thuốc lạm dụng (`rounded-xl`, `border-radius: 24px+` của Liquid Silicon).
   - Chuẩn bán kính góc:
     - Nút bấm, Ô nhập liệu, Chip nhãn: `border-radius: 4px;` (hoặc `rounded-sm` trong Vuetify).
     - Card thẻ, Hộp thoại Dialog: `border-radius: 6px;`.
     - Avatar người dùng: Có thể giữ hình tròn hoặc hình vuông bo góc nhẹ `4px` để tăng chất Brutalist.

---

### 1.3. Hệ Thống Typography (Typography System)

Sự kết hợp giữa phông chữ hình học mạnh mẽ cho nhận diện và phông chữ công thái học cho nội dung văn bản dài:

- **Font Tiêu Đề & Số Liệu:** Google Font **Space Grotesk** (`font-family: 'Space Grotesk', sans-serif; font-weight: 700 / 900`).
  - Dùng cho: Logo thương hiệu, Tiêu đề trang (`h1`, `h2`), Chỉ số thống kê KPI, Nhãn các nút bấm chính, Tên tab.
- **Font Văn Bản & Nội Dung Chat:** Google Font **Plus Jakarta Sans** hoặc **Inter** (`font-weight: 400 / 500 / 600`).
  - Dùng cho: Nội dung tin nhắn hội thoại, danh sách khách hàng, bảng dữ liệu, nội dung báo cáo chi tiết. Đảm bảo nhân viên đọc hàng nghìn tin nhắn mỗi ngày mà không bị mỏi mắt.
- **Lớp Nhãn Kỹ Thuật (`.neo-subtitle`):**
  ```css
  .neo-subtitle {
    font-family: 'Space Grotesk', sans-serif;
    font-weight: 800;
    text-transform: uppercase;
    font-size: 0.75rem;
    letter-spacing: 0.08em;
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

### 3.1. Trạng Thái Tài Khoản Zalo (Zalo Account Indicators)
Hỗ trợ hiển thị nhiều tài khoản Zalo cá nhân cùng lúc:
- **Đang kết nối (Connected):** Badge nền xanh ngọc pastel, chữ xanh đậm, viền `1.5px solid #18181B`, chấm xanh cố định (`ONLINE`).
- **Mất kết nối / Hết hạn session:** Badge nền đỏ pastel, viền 1.5px, kèm nút cơ học nổi bật `[QUÉT LẠI QR]`.
- **Tài khoản đang lọc hội thoại:** Card tài khoản Zalo được bao viền xanh `primary` dày 2px với dấu tích dứt khoát.

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
     - Bo góc: `4px` (không bo tròn viên thuốc).
     - Thời gian tin nhắn: Trắng mờ `rgba(255, 255, 255, 0.75)`, đặt góc dưới.
   - **Bong bóng tin nhắn của Khách hàng (Contact - Căn trái):**
     - Nền: `#FFFFFF` (Light) / `#1F1F23` (Dark).
     - Chữ: `#18181B` (Light) / `#F4F4F5` (Dark).
     - Viền: `1.5px solid #18181B` (Light) / `1.5px solid #3F3F46` (Dark).
     - Bo góc: `4px`.
     - Thời gian tin nhắn: `#71717A` (Light) / `#A1A1AA` (Dark).
   - **Đính kèm Tệp tin & Ảnh:**
     - Ảnh gửi/nhận: Bo viền `1.5px solid #18181B`, bo góc `4px`, xem ảnh mở modal Neo-Brutalism.
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
  - Khung viền `1.5px solid var(--border-color)`.
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
      rounded: 'sm', // 4px border-radius
      elevation: 0,
    },
    VCard: {
      variant: 'flat',
      rounded: 'sm',
      elevation: 0,
    },
    VTextField: {
      variant: 'outlined',
      density: 'compact',
      rounded: 'sm',
    },
    VSelect: {
      variant: 'outlined',
      density: 'compact',
      rounded: 'sm',
    },
    VAutocomplete: {
      variant: 'outlined',
      density: 'compact',
      rounded: 'sm',
    },
    VTextarea: {
      variant: 'outlined',
      density: 'compact',
      rounded: 'sm',
    },
    VChip: {
      rounded: 'sm',
      size: 'small',
      elevation: 0,
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
   - Sử dụng `v-skeleton-loader` với góc bo `4px`, không hiệu ứng sóng lượn bóng nhờn, giữ ổn định layout khi tải danh sách cuộc trò chuyện.
2. **Thông Báo Toasts & Alerts:**
   - Hiển thị góc trên bên phải, viền `1.5px solid #18181B`, nền phẳng chuẩn mã màu trạng thái, chữ đậm rõ ràng.
3. **Hộp Thoại Xác Nhận Thao Tác Nguy Hiểm (Confirm Dialogs):**
   - Xóa tài khoản Zalo, thu hồi tin nhắn, hủy đơn hàng bắt buộc phải mở Hộp thoại Xác nhận.
   - Nút hành động mang màu đỏ (`color="error"`), viền đen `1.5px`, bấm có phản hồi cơ học.

---

## 6. Những Quy Tắc Tuyệt Đối Cấm (Forbidden Design Tropes)

- ❌ **Cấm Bóng Mờ (No Box Shadows):** Tuyệt đối không dùng `box-shadow` hay `drop-shadow` làm mờ ranh giới phần tử.
- ❌ **Cấm Hiệu Ứng Thủy Tinh (No Glassmorphism):** Loại bỏ toàn bộ `backdrop-filter: blur(...)` và nền trong suốt nhiều lớp gây giảm hiệu năng render GPU.
- ❌ **Cấm Viền Phát Sáng & Gradient Nhòe (No Glow & Blurry Halos):** Không dùng viền phát sáng cyan/neon hay animation bồng bềnh (`ai-core-orb`, `liquid-morph`, `flow-bg`).
- ❌ **Cấm Bo Tròn Dạng Viên Thuốc (No Over-rounded Pill Radii):** Không dùng `rounded="xl"`, `rounded="pill"` trên các nút bấm, ô input, cards và chat bubbles chính.
- ❌ **Cấm Màu Tím Lòe Loẹt Trên Nền Tối:** Duy trì bảng màu có độ tương phản đạt chuẩn WCAG AA/AAA cho các ca trực hỗ trợ khách hàng kéo dài.
- ❌ **Cấm Lưu Token Bảo Mật Trong localStorage:** Tuân thủ quy chuẩn bảo mật Cookie `httpOnly` và sanitization dữ liệu DOMPurify.

