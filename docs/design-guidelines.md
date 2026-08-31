# ZaloCRM — Design Guidelines & UI/UX Standards

## 1. Liquid Silicon Design System

Giao diện **ZaloCRM** được thiết kế dựa trên ngôn ngữ thiết kế **Liquid Silicon**, kết hợp giữa tính mềm mại của các viền cong bo nhẹ (border-radius fluid), hiệu ứng kính mờ (backdrop-blur glassmorphism) và khoảng trống trực quan (whitespace balance).

---

## 2. Bảng Màu Hệ Thống (Color System)

Ứng dụng hỗ trợ đồng thời 2 giao diện **Theme Tối (Dark)** và **Theme Sáng (Light)**, sử dụng bảng màu HSL hài hòa:

### 2.1. Theme Tối (Dark Mode - Mặc định)
- **Background Main:** `hsl(222, 47%, 11%)` (`#0F172A` - Slate 900)
- **Surface / Card Background:** `hsl(217, 33%, 17%)` (`#1E293B` - Slate 800)
- **Primary Brand Color (Zalo Blue):** `hsl(217, 91%, 60%)` (`#3B82F6` - Blue 500)
- **Accent Success:** `hsl(142, 71%, 45%)` (`#22C55E` - Green 500)
- **Text Primary:** `hsl(210, 40%, 98%)` (`#F8FAFC`)
- **Text Secondary:** `hsl(215, 20%, 65%)` (`#94A3B8`)

### 2.2. Theme Sáng (Light Mode)
- **Background Main:** `hsl(210, 40%, 98%)` (`#F8FAFC`)
- **Surface / Card Background:** `hsl(0, 0%, 100%)` (`#FFFFFF`)
- **Primary Brand Color:** `hsl(217, 91%, 55%)` (`#2563EB`)
- **Border Neutral:** `hsl(214, 32%, 91%)` (`#E2E8F0`)

---

## 3. Hệ Thống Typography (Typography System)

- **Font Family:** Google Font `Inter`, sans-serif.
- **Quy tắc Legibility:**
  - **Heading 1 (`h1`):** `font-size: 1.875rem (30px)`, `line-height: 2.25rem`, `font-weight: 700`.
  - **Heading 2 (`h2`):** `font-size: 1.5rem (24px)`, `line-height: 2rem`, `font-weight: 600`.
  - **Body Text (`body-1`):** `font-size: 0.875rem (14px)`, `line-height: 1.25rem`, `font-weight: 400`.
  - **Caption / Subtitle:** `font-size: 0.75rem (12px)`, `letter-spacing: 0.05em`.

---

## 4. Quy Chuẩn Component & Layout

### 4.1. Cấu trúc Layout Linh hoạt (Fluid Responsive Layout)
- **Breakpoints (Vuetify 4):**
  - `xs (< 600px)`: Màn hình điện thoại (Ẩn sidebar, hiển thị full-screen chat/contacts).
  - `sm (600px - 960px)`: Màn hình máy tính bảng (Sidebar rút gọn biểu tượng).
  - `md+ (> 960px)`: Màn hình máy tính để bàn (Giao diện 3 cột: Navigation - List - Detail).

### 4.2. Micro-interactions & Visual Effects
- **Button Hover States:** Hiệu ứng chuyển màu mượt mà (`transition: all 0.2s ease-in-out`), tăng nhẹ độ sáng khi hover (`filter: brightness(1.1)`).
- **Trạng thái kết nối Zalo:**
  - `Đã kết nối`: Badge tròn màu xanh lá khẽ nhấp nháy (`animate-pulse`).
  - `Mất kết nối`: Badge đỏ kèm nút quét lại QR Code nổi bật.
- **Hiển thị Tin nhắn Chưa đọc:** Badge số lượng tin nhắn tròn nổi trên khung hội thoại với độ tương phản cao.

---

## 5. Quy Tắc Cấm Thiết Kế (Forbidden Design Tropes)

- **Cấm:** Không dùng font màu tím rực trên nền tối (Purple on dark).
- **Cấm:** Không dùng viền phát sáng màu mè lòe lẹt xung quanh container (No colored border glowing).
- **Cấm:** Tránh lạm dụng thẻ lồng thẻ quá 3 cấp (No over-nested cards).
