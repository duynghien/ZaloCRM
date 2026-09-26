# Hướng dẫn sử dụng ZaloCRM

## Mục lục

1. [Đăng nhập](#1-đăng-nhập)
2. [Kết nối Zalo](#2-kết-nối-zalo)
3. [Chat với khách hàng](#3-chat-với-khách-hàng)
4. [Quản lý khách hàng](#4-quản-lý-khách-hàng)
5. [Lịch hẹn](#5-lịch-hẹn)
6. [Dashboard & Báo cáo](#6-dashboard--báo-cáo)
7. [Quản lý nhân viên](#7-quản-lý-nhân-viên)
8. [API & Webhook](#8-api--webhook)
9. [Câu hỏi thường gặp](#9-câu-hỏi-thường-gặp)
10. [Quy tắc quan trọng](#10-quy-tắc-quan-trọng)
11. [Báo cáo AI](#11-báo-cáo-ai)
12. [Quy tắc giám sát nhóm AI (Audit Rules)](#12-quy-tắc-giám-sát-nhóm-ai-audit-rules)
13. [Trợ lý Copilot thông minh](#13-trợ-lý-copilot-thông-minh)
14. [Gửi tệp đính kèm & Ảnh](#14-gửi-tệp-đính-kèm--ảnh)
15. [Theo dõi & Xuất chi phí AI](#15-theo-dõi--xuất-chi-phí-ai)

---

## 1. Đăng nhập

1. Mở trình duyệt → vào địa chỉ hệ thống
2. Nhập **Email** và **Mật khẩu** → nhấn **Đăng nhập**
3. Chọn theme tối/sáng bằng biểu tượng ☀️/🌙 trên thanh trên cùng

---

## 2. Kết nối Zalo

### Thêm tài khoản Zalo

1. Vào menu **Tài khoản Zalo**
2. Nhấn **Thêm Zalo** → đặt tên (VD: "Sale Hương")
3. Nhấn biểu tượng **QR** → mã QR hiện trên màn hình
4. Mở **Zalo trên điện thoại** → quét mã QR
5. Xác nhận trên điện thoại → trạng thái chuyển sang **Đã kết nối** (xanh)

### Đồng bộ danh bạ

- Nhấn biểu tượng **đồng bộ** (👥↻) bên cạnh tài khoản
- Tất cả bạn bè Zalo sẽ được nhập vào danh sách Khách hàng

### Phân quyền truy cập

- Nhấn biểu tượng **khiên** (🛡️) → chọn nhân viên + quyền
- **Xem:** chỉ xem tin nhắn
- **Chat:** được phép gửi tin nhắn
- **Quản lý:** toàn quyền trên tài khoản Zalo này

> ⚠️ **Lưu ý:** KHÔNG mở Zalo Web trên trình duyệt khi đang dùng hệ thống

---

## 3. Chat với khách hàng

### Giao diện

Giao diện chat chia 3 cột (kéo thả để thay đổi kích thước):

| Cột trái | Cột giữa | Cột phải |
|----------|----------|----------|
| Danh sách hội thoại | Nội dung tin nhắn | Thông tin khách hàng |
| Lọc theo Zalo | Gửi tin nhắn | Lưu thông tin CRM |
| Tìm kiếm | Xem ảnh/file | Lịch hẹn |

### Gửi tin nhắn

1. Chọn cuộc trò chuyện bên trái
2. Gõ tin nhắn vào ô dưới cùng
3. Nhấn **Enter** để gửi
4. **Shift + Enter** = xuống dòng

### Xem ảnh và file

- **Ảnh:** hiển thị trực tiếp → nhấn để phóng to
- **File/PDF:** hiện thẻ tên file + dung lượng → nhấn để tải
- **Nhắc hẹn Zalo:** hiện thẻ 📅 với thời gian → nhấn **Đồng bộ lịch**

### Lọc theo Zalo

- Ở đầu danh sách hội thoại → chọn **tên Zalo cụ thể**
- Chọn "Tất cả Zalo" để xem toàn bộ

### Cập nhật thông tin khách hàng

1. Nhấn biểu tượng **👤** (góc phải header chat) → panel thông tin mở ra
2. Điền: Họ tên, SĐT, Email, Nguồn, Trạng thái, Ngày tiếp nhận, Ghi chú, Tags
3. Nhấn **Lưu thông tin**
4. Dữ liệu tự động đồng bộ sang tab **Khách hàng**

### Tạo lịch hẹn từ chat

1. Trong panel thông tin → mục **Lịch hẹn**
2. Nhấn **+** → điền ngày, giờ, ghi chú → **Tạo lịch hẹn**

---

## 4. Quản lý khách hàng

Vào menu **Khách hàng**

### Xem danh sách

- Bảng hiển thị: Tên, SĐT, Email, Nguồn, Trạng thái, Ngày tiếp nhận
- **Tìm kiếm:** gõ tên hoặc SĐT
- **Lọc:** chọn Nguồn hoặc Trạng thái

### Pipeline khách hàng

| Trạng thái | Ý nghĩa | Màu |
|-----------|---------|-----|
| **Mới** | Khách hàng mới, chưa liên hệ | Xám |
| **Đã liên hệ** | Đã liên hệ lần đầu | Xanh dương |
| **Quan tâm** | Khách quan tâm sản phẩm/dịch vụ | Cam |
| **Chuyển đổi** | Đã mua/sử dụng dịch vụ | Xanh lá |
| **Mất** | Không còn quan tâm | Đỏ |

### Thêm khách hàng

1. Nhấn **Thêm KH** → điền thông tin → **Lưu**

### Sửa thông tin

1. Nhấn vào dòng khách hàng → dialog chi tiết mở ra
2. Sửa bất kỳ trường nào → **Lưu**

---

## 5. Lịch hẹn

Vào menu **Lịch hẹn**

### 3 tab xem

| Tab | Hiển thị |
|-----|---------|
| **Hôm nay** | Lịch hẹn trong ngày |
| **Sắp tới** | 7 ngày tiếp theo |
| **Tất cả** | Toàn bộ lịch hẹn |

### Tạo lịch hẹn

1. Nhấn **Tạo lịch hẹn**
2. Chọn khách hàng, ngày, giờ, loại
3. Ghi chú (nếu có) → **Tạo**

### Cập nhật nhanh

| Nút | Hành động |
|-----|----------|
| ✅ | Đánh dấu **Hoàn thành** |
| ❌ | **Huỷ** lịch hẹn |
| ✏️ | Sửa ngày/giờ/ghi chú |

### Nhắc nhở tự động

- Hệ thống tự kiểm tra lịch hẹn **ngày mai** lúc 8:00 sáng
- Thông báo hiện trong chuông 🔔 trên thanh trên cùng

---

## 6. Dashboard & Báo cáo

### Dashboard (trang chủ)

6 ô thống kê:
- Tin nhắn hôm nay | Chưa trả lời | Chưa đọc
- Lịch hẹn hôm nay | Khách mới tuần này | Tổng khách hàng

Biểu đồ:
- Tin nhắn gửi/nhận theo ngày (30 ngày)
- Pipeline khách hàng (biểu đồ tròn)
- Nguồn khách hàng (biểu đồ tròn)

### Báo cáo

1. Vào menu **Báo cáo**
2. Chọn **khoảng thời gian** (từ ngày – đến ngày)
3. Chọn tab: **Tin nhắn** / **Khách hàng** / **Lịch hẹn**
4. Nhấn **Xuất Excel** → tải file .xlsx về máy

---

## 7. Quản lý nhân viên

Vào menu **Nhân viên** (chỉ Admin/Owner)

### Vai trò

| Vai trò | Quyền |
|---------|-------|
| **Owner** | Toàn quyền, quản lý admin |
| **Admin** | Quản lý nhân viên, Zalo, khách hàng |
| **Member** | Chỉ xem Zalo được phân quyền |

### Thêm nhân viên

1. Tab **Nhân viên** → nhấn **Thêm nhân viên**
2. Nhập: Email, Họ tên, Mật khẩu, Vai trò → **Tạo**

### Đội nhóm

1. Tab **Đội nhóm** → **Thêm đội nhóm** → đặt tên
2. Mở rộng đội nhóm → **Thêm thành viên**

---

## 8. Cổng API & Webhook Chuyên Nghiệp (Pro API & Webhook Gateway)

Dành cho lập trình viên và doanh nghiệp tích hợp ZaloCRM với các hệ thống ERP, KiotViet, Sapo, n8n, CRM bên ngoài hoặc ứng dụng nội bộ.

### 8.1. Quản Lý Khóa API Đa Khóa (Multi-Key Management)

ZaloCRM hỗ trợ tạo không giới hạn API Key độc lập cho từng hệ thống đối tác hoặc dịch vụ tích hợp với nguyên tắc phân quyền tối thiểu (Least Privilege).

1. Vào menu **Cấu hình** → tab **Khóa API**.
2. Nhấn nút **+ Tạo Khóa API Mới**.
3. Điền thông tin:
   - **Tên khóa**: Định danh đối tác/hệ thống sử dụng (ví dụ: `KiotViet Sync`, `n8n Automation`).
   - **Phân quyền (Scopes)**: Chọn chính xác các quyền cần thiết:
     - `contacts:read`, `contacts:write`: Xem và quản lý danh bạ khách hàng.
     - `orders:read`, `orders:write`: Xem và tạo đơn hàng (hỗ trợ line items tự do).
     - `appointments:read`, `appointments:write`: Xem và tạo lịch hẹn tư vấn/chăm sóc.
     - `messages:send`: Gửi tin nhắn Zalo đến khách hàng.
     - `conversations:read`: Đọc dữ liệu hội thoại, tin nhắn.
     - `zalo_accounts:read`: Xem danh sách tài khoản Zalo đang kết nối (tuyệt đối bảo mật session/cookies).
   - **Giới hạn tốc độ (Rate Limit)**: Số request tối đa/phút (mặc định 60, tối đa 1000). Hệ thống kiểm soát qua bộ đếm trượt nguyên tử (Atomic Sliding-Window Rate Limiter).
   - **Hạn dùng (Expiration)**: Để trống nếu không bao giờ hết hạn, hoặc chọn ngày thu hồi tự động.
4. Nhấn **Tạo Khóa**: Hệ thống hiển thị khóa bí mật dạng `zcrm_...` **duy nhất 1 lần**. Hãy sao chép và lưu trữ an toàn vào biến môi trường!

### 8.2. Gọi API Công Khai (Public REST Endpoints)

Truyền API Key vào header `X-API-Key` trong mỗi yêu cầu:

```bash
# 1. Lấy danh sách tài khoản Zalo đang kết nối
curl -H "X-API-Key: zcrm_your_key_here" \
  https://your-domain/api/public/zalo-accounts

# 2. Tạo đơn hàng mới từ Landing Page / ERP ngoài (hỗ trợ mặt hàng tự do & phân bổ mã đơn chống trùng lặp)
curl -X POST -H "X-API-Key: zcrm_your_key_here" -H "Content-Type: application/json" \
  -d '{
    "phone": "0988888888",
    "fullName": "Nguyễn Văn A",
    "totalAmount": 450000,
    "items": [
      { "productName": "Combo Chăm Sóc Da Pro", "quantity": 1, "price": 450000 }
    ],
    "notes": "Đơn hàng từ Website Shopify"
  }' \
  https://your-domain/api/public/orders

# 3. Gửi tin nhắn Zalo tự động
curl -X POST -H "X-API-Key: zcrm_your_key_here" -H "Content-Type: application/json" \
  -d '{
    "zaloAccountId": "acc-uuid",
    "threadId": "user-zalo-id",
    "content": "Cảm ơn quý khách đã đặt hàng tại shop!",
    "threadType": 0
  }' \
  https://your-domain/api/public/messages/send
```

### 8.3. Webhook Tinh Gọn (Granular Webhooks) & An Toàn SSRF

Hệ thống cung cấp cơ chế Webhook Outbox với khả năng khớp sự kiện tiền tố (Wildcard Matching), mã hóa bí mật AES-256-GCM, phòng vệ SSRF nghiêm ngặt (chỉ chấp nhận HTTPS công khai) và ngắt mạch tự động (Circuit Breaker) sau 50 lần gửi thất bại liên tiếp:

1. Vào tab **Webhook Subscriptions** → nhấn **+ Thêm Điểm Nhận Tin**.
2. Nhập URL máy chủ nhận tin (bắt buộc giao thức HTTPS hợp lệ, không dùng IP nội bộ/loopback/cloud metadata).
3. Đăng ký các sự kiện cần lắng nghe:
   - `contact.*`: Tất cả sự kiện khách hàng (`contact.created`, `contact.updated`).
   - `order.*`: Tất cả sự kiện đơn hàng (`order.created`, `order.updated`).
   - `appointment.*`: Sự kiện lịch hẹn (`appointment.created`, `appointment.updated`).
   - `*`: Nhận toàn bộ sự kiện hệ thống.
4. Nhập hoặc sinh mã bảo mật (Shared Secret) dùng để ký HMAC.

### 8.4. Xác Thực Chữ Ký Webhook & Chống Tấn Công Gửi Lại (Replay Attack Defense)

Mỗi lượt gửi Webhook từ ZaloCRM đi kèm 2 header chữ ký:
- `X-ZaloCRM-Signature`: Chữ ký HMAC-SHA256 chuẩn (V1 hex digest).
- `X-ZaloCRM-Signature-V2`: Chữ ký phiên bản 2 chống phát lại với định dạng `t=<timestamp>,v2=<hmac-hex>`.

#### Mẫu Xác Thực Bằng Node.js:
```javascript
import crypto from 'node:crypto';

export function verifyZaloCrmWebhook(rawBody, signatureV2Header, sharedSecret) {
  // 1. Phân tích header t=timestamp,v2=signature
  const parts = Object.fromEntries(
    signatureV2Header.split(',').map(kv => kv.trim().split('='))
  );
  const timestamp = parseInt(parts.t, 10);
  const signature = parts.v2;

  // 2. Chống Replay Attack: Từ chối gói tin quá 5 phút (300 giây)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > 300) {
    throw new Error('Webhook timestamp skew exceeds tolerance');
  }

  // 3. Tính toán HMAC-SHA256 trên chuỗi "${timestamp}.${rawBody}"
  const payloadToSign = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', sharedSecret)
    .update(payloadToSign)
    .digest('hex');

  // 4. So sánh chuỗi với thời gian hằng số (Timing-safe comparison)
  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );

  return isValid;
}
```

#### Mẫu Xác Thực Bằng Python:
```python
import hmac, hashlib, time

def verify_zalocrm_webhook(raw_body_bytes, signature_v2_header, shared_secret):
    parts = dict(item.strip().split('=') for item in signature_v2_header.split(','))
    timestamp = int(parts['t'])
    expected_sig = parts['v2']

    # Tolerance 300s
    if abs(int(time.time()) - timestamp) > 300:
        return False

    signed_payload = f"{timestamp}.".encode('utf-8') + raw_body_bytes
    computed_sig = hmac.new(shared_secret.encode('utf-8'), signed_payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(computed_sig, expected_sig)
```

### 8.5. Giám Sát Nhật Ký & Hàng Đợi Thất Bại (DLQ)

- Tại tab **Nhật Ký & DLQ**, quản trị viên theo dõi trạng thái phân phát thời gian thực (`pending`, `delivered`, `failed`, `dead_letter`, `paused`).
- Với các gói tin bị lỗi quá 5 lần hoặc webhook bị ngắt mạch, sau khi sửa xong server nhận tin, nhấn **Thử Lại (Retry)** để hệ thống đặt lại bộ đếm và gửi lại ngay lập tức.
- Tab **Tài Liệu API** cung cấp giao diện OpenAPI/Swagger tương tác trực quan để thử nghiệm các endpoint trực tiếp trên trình duyệt.

---

## 9. Câu hỏi thường gặp

### "Zalo bị ngắt kết nối?"

Hệ thống tự kết nối lại trong 30 giây. Nếu không được → vào **Tài khoản Zalo** → quét QR lại.

### "Tin nhắn không gửi được?"

Kiểm tra trạng thái Zalo (phải xanh lá). Nếu hiện "Gửi quá nhanh" → đợi 30 giây.

### "Không thấy tin nhắn cũ?"

Hệ thống chỉ lưu tin nhắn từ lúc kết nối Zalo. Tin nhắn trước đó không có.

### "Lịch hẹn bị trùng?"

Hệ thống tự phát hiện — nếu cùng khách hàng + cùng ngày → báo lỗi.

### "Quên mật khẩu?"

Liên hệ Admin/Owner để reset mật khẩu trong **Cài đặt → Nhân viên**.

---

## 10. Quy tắc quan trọng

### ❌ KHÔNG làm

1. **KHÔNG mở Zalo Web** trên trình duyệt khi dùng hệ thống
2. **KHÔNG gửi tin spam** (cùng nội dung cho nhiều người)
3. **KHÔNG gửi tin cho người lạ** (không phải bạn bè Zalo)
4. **KHÔNG gửi quá 200 tin/ngày** trên 1 tài khoản Zalo
5. **KHÔNG chia sẻ mật khẩu** cho người khác

### ✅ NÊN làm

1. **Cập nhật thông tin** khách hàng đầy đủ (SĐT, trạng thái)
2. **Trả lời tin nhắn** trong vòng 30 phút
3. **Ghi chú lịch hẹn** ngay khi hẹn khách
4. **Đồng bộ danh bạ** Zalo khi thêm bạn mới
5. **Kiểm tra Dashboard** mỗi sáng


## 11. Báo cáo AI

1. Mở **Báo cáo AI**, chọn từng nhóm kèm tài khoản Zalo nguồn. Cùng một nhóm xuất hiện qua hai tài khoản là hai nguồn riêng; chọn tối đa 20 nguồn.
2. Chọn khoảng ngày tối đa 31 ngày lịch gồm hai đầu. Với API, hai thời điểm sau chuẩn hóa UTC phải cách nhau không quá 30 × 24 giờ; ngày không tồn tại hoặc khoảng đảo ngược bị từ chối.
3. Nếu gửi qua Zalo, chọn rõ **tài khoản gửi** và nơi nhận (bản thân, Cloud hoặc UID). Tài khoản gửi có thể khác tài khoản nguồn, nhưng phải có quyền phù hợp và đang kết nối.
4. Nếu gửi email, nhập tối đa 10 địa chỉ hợp lệ, không trùng sau khi bỏ khoảng trắng và chuyển chữ thường. Owner/Admin cấu hình SMTP và tự động hóa; mật khẩu đã lưu không được trả lại trên giao diện.

Nguồn và tài khoản gửi được kiểm tra quyền lại trong quá trình xử lý. Khi mất quyền hoặc tài khoản ngắt kết nối, báo cáo có thể dừng gửi. Mỗi người dùng chỉ có một tác vụ AI đang hoạt động, mỗi tổ chức tối đa hai.

**Dữ liệu cũ:** cấu hình chưa xác định được tài khoản nguồn cần Owner/Admin chọn lại nguồn rồi lưu trước khi bật lịch. Báo cáo cũ chưa xác minh nguồn chỉ Owner/Admin cùng tổ chức được xem, không gửi lại. Tác vụ cũ chưa kết thúc khi nâng cấp được đánh dấu thất bại; muốn chạy lại phải tạo yêu cầu mới có chủ đích.

**Gửi lại:** khi kết quả không rõ hoặc đã gửi một phần, kiểm tra trực tiếp người nhận trước. Thử lại cùng lượt chỉ lấy lại kết quả đã ghi nhận. Sau khi đối soát, dùng **Đã đối soát — tạo lượt gửi mới** nếu thực sự cần gửi lại; lượt mới có thể gửi trùng phần người nhận đã nhận. Đóng/mở hộp thoại hoặc tải lại trang không tự tạo lượt mới cho kết quả chưa rõ.
 
---

## 12. Quy tắc giám sát nhóm AI (Audit Rules)

Dành cho Owner/Admin quản lý và đánh giá tự động việc nộp kế hoạch, tiến độ công việc hoặc hình ảnh trong các nhóm Zalo làm việc.

### 12.1. Truy cập
1. Vào menu **Báo cáo AI** trên thanh điều hướng.
2. Chọn tab **🎯 Quy Tắc Giám Sát**.

### 12.2. Tạo quy tắc mới
1. Nhấn nút **Thêm Quy Tắc Mới**.
2. **Thông tin cơ bản:**
   - **Tên quy tắc:** Nhập tên mô tả (VD: "Điểm danh lịch sáng - Đội Sale").
   - **Tài khoản Zalo & Nhóm nguồn:** Chọn tài khoản Zalo kết nối và nhóm chat làm việc cần kiểm tra.
   - **Kịch bản kiểm tra:**
     - *Nộp lịch / Kế hoạch ngày* (`schedule_submission`): Đánh giá việc nộp lịch công tác, kế hoạch di chuyển buổi sáng.
     - *Tiến độ công việc / KPI* (`work_progress`): Đánh giá việc hoàn thành mục tiêu, báo cáo số liệu trong ca làm việc.
     - *Thẩm định hình ảnh / Biên bản* (`image_verification`): AI Multimodal Vision phân tích tối đa 15 ảnh mới nhất (chất lượng ảnh, tính hợp lệ biên bản, hiện trường).
     - *Tùy chỉnh* (`custom`): Nhập hướng dẫn prompt riêng theo yêu cầu doanh nghiệp.
3. **Lập lịch & Khung thời gian quét:**
   - **Giờ chạy (HH:mm):** Cài đặt giờ chạy tự động theo múi giờ Việt Nam (Asia/Ho_Chi_Minh).
   - **Ngày chạy trong tuần:** Chọn các ngày từ Thứ 2 đến Chủ Nhật.
   - **Khung thời gian quét tin nhắn:** Chọn *Từ đầu ngày hôm nay (00:00)* hoặc *N giờ gần nhất*.
4. **Nhân sự kiểm tra:**
   - **Nhập danh sách cụ thể:** Nhập họ tên hoặc biệt danh từng nhân viên (mỗi tên một dòng).
   - **Để trống:** Hệ thống tự động phân giải toàn bộ thành viên trong nhóm Zalo qua API và bộ đệm an toàn (không dựa vào tin nhắn chat để tránh bỏ sót nhân sự im lặng).
5. **Điều phối đa kênh (Dual-Channel Dispatch):**
   - **Nhóm Zalo Giám sát đích:** Chọn nhóm của ban quản lý/chỉ huy để nhận báo cáo thẩm định chuyên sâu (phân loại 3 tầng: Đã xong, Chưa ghi nhận/cần đối chiếu, Bất thường/nộp muộn).
   - **Gửi tin nhắn nhắc nhở vào nhóm làm việc nguồn:** Bật/tắt tùy chọn phát sóng thông điệp điểm danh văn minh, lịch sự nhắc nhở nhân sự chưa nộp bổ sung. Khi 100% nhân sự hoàn thành, bot gửi thông điệp khích lệ, biểu dương nhóm.
6. Nhấn **Lưu Quy Tắc**.

### 12.3. Chạy thử ngay (Run Now)
- Tại bảng danh sách quy tắc, nhấn nút **⚡ Chạy Thử Ngay** trên bất kỳ quy tắc nào đang bật (`Active`).
- Hệ thống sẽ kích hoạt AI đánh giá tức thì (< 15 giây) và hiển thị kết quả trực tiếp trên modal gồm 2 tab:
  - **Báo cáo Giám Sát:** Xem trước bản báo cáo Markdown phân loại chi tiết.
  - **Tin Nhắn Nhắc Nhở:** Xem trước nội dung tin nhắn sẽ gửi vào nhóm làm việc.
- Kết quả chạy thử được lưu tự động vào **Lịch Sử Báo Cáo** (kèm nhãn Chạy Thử) để tra cứu lại bất kỳ lúc nào mà không tốn thêm token AI.

### 12.4. Trạng thái thực thi & Xử lý lỗi
- Bảng quy tắc hiển thị huy hiệu trạng thái lần chạy gần nhất:
  - 🟢 **Thành công:** Đã hoàn tất đánh giá và phát hành thông điệp thành công.
  - 🟠 **Lỗi gửi tin (dispatch_failed):** Báo cáo AI đã thẩm định và lưu an toàn, nhưng Zalo gửi tin gặp sự cố (mất quyền, gửi quá nhanh). Bạn có thể vào tab **Lịch Sử Báo Cáo** để kiểm tra và nhấn **Gửi lại (Resend)** sau khi khắc phục Zalo.
  - 🔴 **Thất bại:** Quá trình đánh giá AI gặp lỗi kỹ thuật.
- Có thể tạm dừng hoặc bật lại quy tắc bất kỳ lúc nào bằng nút gạt Bật/Tắt trên bảng.

---

## 13. Trợ lý Copilot thông minh

Trợ lý ảo Copilot được tích hợp trực tiếp ngay trên khung soạn thảo tin nhắn, hỗ trợ nhân viên tư vấn phản hồi khách hàng nhanh chóng và chính xác.

### 13.1. Phân tích cảm xúc & Ý định mua hàng
- Khi nhận được tin nhắn từ khách hàng, Copilot tự động phân tích và hiển thị:
  - **Huy hiệu Cảm xúc:** `Tích cực` (xanh lá), `Tiêu cực` (đỏ), hoặc `Trung tính` (xám).
  - **Điểm Ý định mua hàng (Buying Intent):** Thang điểm từ 0% đến 100%. Điểm càng cao cho thấy khách hàng đang có nhu cầu chốt đơn cấp thiết.

### 13.2. Gợi ý trả lời nhanh (Smart Replies)
- Copilot đưa ra tối đa 3 câu trả lời phù hợp nhất với ngữ cảnh hiện tại.
- **Cách sử dụng:**
  - Click chuột vào chip câu trả lời muốn chọn.
  - Hoặc dùng phím tắt: **Alt + 1**, **Alt + 2**, hoặc **Alt + 3**.
  - Nội dung sẽ được điền ngay vào ô nhập tin nhắn để bạn chỉnh sửa thêm trước khi nhấn gửi.

### 13.3. Thẻ thao tác nhanh (Quick Draft)
- Khi khách hàng cung cấp thông tin mua hàng hoặc hẹn lịch trong đoạn chat, Copilot sẽ tự động bóc tách và hiển thị thẻ hành động:
  - **Tạo Đơn Hàng:** Bấm để mở form tạo đơn với Họ tên, SĐT, Địa chỉ và Sản phẩm đã được điền sẵn 100%.
  - **Đặt Lịch Hẹn:** Bấm để mở form hẹn lịch với thời gian và ghi chú khách yêu cầu.
  - **Lưu Địa Chỉ:** Bấm để cập nhật địa chỉ giao hàng vào hồ sơ khách hàng mà không cần gõ lại.

### 13.4. Xử lý khiếu nại & Bất thường (Anomaly Alert)
- Khi phát hiện khách hàng bức xúc, tranh chấp hoặc khiếu nại chất lượng dịch vụ:
  - Hệ thống sẽ hiển thị một **Banner Cảnh Báo Đỏ** nổi bật phía trên khung chat.
  - Cung cấp sẵn mẫu câu xoa dịu, xin lỗi và hướng giải quyết chuyên nghiệp.
  - Sau khi nhân viên đã giải quyết xong thỏa đáng với khách hàng, nhấn nút **Đã xử lý khiếu nại** trên banner để gỡ cảnh báo.

---

## 14. Gửi tệp đính kèm & Ảnh

Hệ thống hỗ trợ gửi và nhận tin nhắn đa phương tiện linh hoạt, an toàn và trực quan.

### 14.1. Thêm tệp vào khay chờ (Staged Media)
Bạn có thể thêm tối đa 5 tệp (ảnh hoặc tài liệu) cùng lúc bằng 3 cách:
1. **Dán từ Clipboard:** Chụp màn hình hoặc copy ảnh rồi nhấn **Ctrl + V** (hoặc **Cmd + V** trên Mac) trực tiếp vào ô chat.
2. **Kéo thả:** Kéo tệp ảnh/tài liệu từ máy tính và thả vào vùng chat.
3. **Nút đính kèm:** Nhấn biểu tượng kẹp giấy 📎 cạnh ô nhập liệu để duyệt tệp trên máy tính.

### 14.2. Quản lý khay chờ
- Các tệp đang chờ gửi sẽ xuất hiện ở thanh khay chờ (`StagedMediaBar`) ngay trên ô soạn thảo.
- Bạn có thể xem trước thumbnail của ảnh, kiểm tra dung lượng và tên tệp.
- Nhấn dấu **[×]** trên từng ảnh để xóa tệp không muốn gửi, hoặc nhấn **Hủy tất cả** để xóa toàn bộ khay chờ.

### 14.3. Gửi tin nhắn kèm tệp
- Gõ thêm nội dung tin nhắn văn bản (nếu cần) rồi nhấn nút **Gửi** (hoặc phím **Enter**).
- Hệ thống sẽ tải tệp lên máy chủ an toàn, sinh vé bảo mật và chuyển tiếp tới Zalo của khách hàng.

### 14.4. Xem ảnh phóng to (Lightbox)
- Khi có ảnh trong luồng chat (cả ảnh khách gửi và ảnh bạn gửi), click chuột trực tiếp vào ảnh để mở trình xem ảnh phóng to toàn màn hình (`Lightbox`).
- Nhấn nút **Tải về** để lưu tệp gốc về máy tính hoặc nhấn **Đóng** (hoặc phím **Esc**) để quay lại khung chat.

---

## 15. Theo dõi & Xuất chi phí AI

Dành cho Quản trị viên (Owner/Admin) kiểm soát chi phí sử dụng các mô hình trí tuệ nhân tạo (Gemini, OpenAI, DeepSeek).

### 15.1. Thẻ KPI chi phí trên Dashboard
- Truy cập trang **Dashboard** chính để xem thẻ **Chi phí AI Tháng này**.
- Thẻ hiển thị tổng số tiền (USD và quy đổi VNĐ), kèm tỷ lệ phần trăm tăng/giảm so với tháng trước.

### 15.2. Báo cáo chi tiết sử dụng AI
- Vào menu **Báo cáo AI** → chọn tab **📊 Chi Phí Sử Dụng**.
- Xem biểu đồ thống kê trực quan:
  - Phân bổ chi phí theo **Nhà cung cấp / Mô hình** (Google Gemini, OpenAI GPT-4o, DeepSeek).
  - Phân bổ chi phí theo **Tính năng nghiệp vụ** (Copilot chat, Báo cáo điều hành tổng hợp, Thẩm định quy tắc nhóm, Kiểm tra kết nối).
- Bảng kê chi tiết từng ngày: Số lượt gọi, số token đầu vào (prompt), số token đầu ra (completion), token cache và tổng chi phí.

### 15.3. Xuất file Excel đối soát
- Tại tab Chi Phí Sử Dụng, nhấn nút **📥 Xuất Báo Cáo Excel**.
- Hệ thống sẽ tự động tổng hợp và tải về file `.xlsx` định dạng chuẩn, phục vụ công tác thanh toán và đối soát ngân sách hàng tháng.

---

## 16. Tích Hợp KiotViet & Xuất Hóa Đơn Tự Động

Hệ thống cho phép kết nối trực tiếp với phần mềm quản lý bán hàng KiotViet để đồng bộ danh mục sản phẩm, chọn sản phẩm khi lên đơn, ghi nhận thanh toán thực thu và tự động xuất hóa đơn khi đơn hàng được xác nhận.

### 16.1. Cấu hình tích hợp KiotViet (Dành cho Quản trị viên)
1. Truy cập **Cài đặt** (Settings) → chọn tab **🛒 KiotViet**.
2. Nhập các thông tin kết nối từ tài khoản KiotViet (đăng ký trong mục Thiết lập cửa hàng → Quản lý API trên KiotViet):
   - **Tên gian hàng (Retailer):** Tên gian hàng KiotViet của bạn.
   - **Client ID:** Mã định danh ứng dụng API.
   - **Client Secret:** Khóa bí mật (được mã hóa bảo mật chuẩn AES-256-GCM tại máy chủ).
3. Nhấn **Kiểm tra kết nối** để xác thực thông tin đăng nhập với KiotViet.
4. Sau khi kết nối thành công, hệ thống sẽ tự động tải danh sách cấu hình để bạn chọn:
   - **Chi nhánh mặc định:** Chi nhánh KiotViet xuất kho và lập hóa đơn.
   - **Người bán mặc định:** Nhân viên KiotViet phụ trách đơn hàng.
   - **Tài khoản thanh toán mặc định:** Tài khoản nhận tiền khi khách chuyển khoản/thẻ.
   - **Tự động xuất hóa đơn:** Bật tùy chọn này để đơn hàng tự động xuất hóa đơn sang KiotViet ngay khi đơn được chuyển sang trạng thái **Đã xác nhận (Confirmed)**.
5. Nhấn **Lưu cấu hình**.

### 16.2. Đồng bộ danh mục sản phẩm KiotViet
- Trong tab **KiotViet** tại Cài đặt, bạn sẽ thấy bảng điều khiển **Đồng bộ danh mục sản phẩm**:
  - **Số lượng sản phẩm:** Tổng số sản phẩm đã đồng bộ vào cơ sở dữ liệu ZaloCRM.
  - **Lần đồng bộ gần nhất:** Thời gian và trạng thái lượt đồng bộ trước.
- **Đồng bộ gia tăng (Incremental Sync):** Nhấn để cập nhật các sản phẩm mới thêm hoặc vừa thay đổi giá/tồn kho kể từ lần đồng bộ trước.
- **Đồng bộ toàn bộ (Full Sync):** Đồng bộ lại toàn bộ danh mục sản phẩm từ KiotViet.
- *Lưu ý về phạm vi sản phẩm (v1):* Hệ thống chỉ hỗ trợ **Hàng hóa thông thường (Normal goods)**. Các mặt hàng quản lý theo Số Serial/IMEI, Lô - Hạn sử dụng hoặc Combo/Đóng gói sẽ hiển thị cảnh báo và bị chặn xuất hóa đơn tự động để tránh sai lệch tồn kho.

### 16.3. Lên đơn hàng với sản phẩm & Ghi nhận thanh toán
Bạn có thể tạo đơn hàng từ giao diện **Đơn hàng (Orders)** hoặc trực tiếp tại bảng đơn hàng trong khung chat (**ChatOrders**):
1. **Chọn sản phẩm:**
   - Gõ tên hoặc mã SKU vào ô tìm kiếm sản phẩm.
   - Danh sách sản phẩm gợi ý sẽ hiển thị tên, mã SKU, giá niêm yết và số lượng tồn kho tại chi nhánh đã chọn.
   - Chọn sản phẩm, nhập số lượng, điều chỉnh đơn giá và chiết khấu (nếu bạn có quyền Quản trị viên/Chủ cửa hàng; nhân viên thông thường áp dụng theo giá niêm yết).
   - Hệ thống tự động tính tổng tiền hàng, chiết khấu và tổng giá trị đơn hàng theo chuẩn làm tròn VNĐ.
2. **Ghi nhận thanh toán độc lập:**
   - **Số tiền đã thanh toán:** Nhập số tiền thực tế khách đã trả (hỗ trợ 0đ, thanh toán một phần đặt cọc, hoặc thanh toán toàn bộ).
   - **Phương thức thanh toán:** Chọn `Tiền mặt` (Cash), `Chuyển khoản` (Transfer) hoặc `Thẻ` (Card).
   - **Tài khoản nhận tiền:** Chọn tài khoản ngân hàng/ví tiếp nhận khi phương thức là Chuyển khoản hoặc Thẻ.
3. **Đơn hàng chỉ có tổng tiền (Amount-only):**
   - Đơn tạo nhanh hoặc trích xuất từ Copilot chỉ có tổng tiền vẫn được lưu bình thường trên CRM.
   - Tuy nhiên, để xuất hóa đơn KiotViet, nhân viên cần bổ sung ít nhất một sản phẩm KiotViet hợp lệ vào đơn.

### 16.4. Xử lý khách hàng KiotViet
- Khi xuất hóa đơn, hệ thống tự động tìm kiếm khách hàng trên KiotViet dựa theo số điện thoại đã chuẩn hóa của liên hệ Zalo:
  - **Khớp 1 khách hàng:** Tự động liên kết hóa đơn với khách hàng đó trên KiotViet.
  - **Khớp nhiều khách hàng trùng SĐT:** Hệ thống hiển thị hộp thoại cho nhân viên chọn đúng hồ sơ khách hàng.
  - **Chưa có trên KiotViet:** Cho phép nhân viên tạo nhanh hồ sơ khách hàng mới trên KiotViet hoặc xuất hóa đơn cho khách lẻ.

### 16.5. Trạng thái xuất hóa đơn KiotViet
Tại danh sách đơn hàng, cột **KiotViet** hiển thị trạng thái xử lý:
- ⚪ **Chưa xuất (None):** Đơn chưa gửi sang KiotViet (chưa xác nhận hoặc chưa có sản phẩm).
- 🟡 **Đang xuất (Pending):** Đơn hàng đã được đưa vào hàng đợi xử lý bền vững (Durable Outbox Queue) và đang được tiến trình nền gửi sang KiotViet.
- 🟢 **Đã xuất (Synced):** Hóa đơn đã được tạo thành công trên KiotViet. Mã hóa đơn (ví dụ `HDB000123`) hiển thị kèm nút sao chép nhanh.
- 🔴 **Thất bại (Failed):** Xuất hóa đơn không thành công (do lỗi dữ liệu, thiếu thông tin...). Rê chuột vào biểu tượng lỗi để xem nguyên nhân chi tiết và bấm **Thử lại**.
- 🟠 **Cần đối soát (Uncertain):** Trạng thái xuất hiện khi việc gửi yêu cầu gặp sự cố mạng, timeout hoặc KiotViet phản hồi không rõ ràng. Để bảo vệ an toàn tuyệt đối tránh tạo trùng hóa đơn và trừ kho 2 lần, hệ thống sẽ **không tự động gửi lại** mà chuyển sang chế độ chờ đối soát thủ công.

### 16.6. Khóa an toàn tài chính (Financial Immutability)
- Nhằm đảm bảo số liệu giữa ZaloCRM và KiotViet hoàn toàn đồng nhất:
  - Khi đơn hàng ở trạng thái **Đang xuất (Pending)**, **Cần đối soát (Uncertain)** hoặc **Đã xuất (Synced)**, toàn bộ các trường tài chính (danh sách sản phẩm, số lượng, đơn giá, chiết khấu, tổng tiền, tiền đã thanh toán, phương thức thanh toán, chi nhánh) sẽ **bị khóa hoàn toàn**.
  - Không thể hủy (cancel) hoặc xóa (delete) đơn hàng đã xuất hóa đơn trên CRM.
  - Các thông tin phi tài chính như ghi chú nội bộ hoặc trạng thái giao hàng vẫn được phép cập nhật bình thường.
  - Nếu cần điều chỉnh sản phẩm hoặc hủy đơn, nhân viên thực hiện thao tác trực tiếp trên phần mềm KiotViet và cập nhật ghi chú trên CRM.

### 16.7. Đối soát hóa đơn bất định (Admin Reconciliation)
Dành cho Quản trị viên khi đơn hàng ở trạng thái **Cần đối soát (Uncertain)**:
1. Nhấn nút **Đối soát** (biểu tượng chiếc khiên/cân) trên đơn hàng cần xử lý.
2. Kiểm tra trên giao diện KiotViet xem hóa đơn của đơn hàng này đã thực sự được tạo hay chưa:
   - **Nếu hóa đơn ĐÃ TẠO trên KiotViet:** Chọn **Liên kết mã hóa đơn**, nhập mã hóa đơn KiotViet (ví dụ `HDB000123`) → Đơn chuyển sang trạng thái `Đã xuất`.
   - **Nếu hóa đơn CHƯA TẠO trên KiotViet:** Chọn **Xác nhận chưa tạo trên KiotViet** → Đơn chuyển về trạng thái `Thất bại`, cho phép nhân viên kiểm tra lại và bấm gửi lại an toàn.
   - **Kiểm tra tự động:** Nhấn **Làm mới trạng thái** để hệ thống truy vấn lại KiotViet và tự động cập nhật nếu đã có kết quả.
