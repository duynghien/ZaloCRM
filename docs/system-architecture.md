# ZaloCRM — System Architecture & Design Specification

## 1. High-Level System Architecture

Hệ thống **ZaloCRM** được thiết kế theo kiến trúc Monolith hiện đại, chia tách rõ ràng giữa Frontend (Vue 3 Single Page Application) và Backend (Node.js Fastify REST API + WebSocket Server), lưu trữ dữ liệu tập trung trên cơ sở dữ liệu quan hệ PostgreSQL 16.

```mermaid
graph TD
    Client[Browser / Frontend Vue 3 App] -->|HTTPS / REST API| Nginx[Nginx Reverse Proxy]
    Client -->|WSS / Socket.IO| Nginx
    
    subgraph App Container
        Nginx -->|Port 3000| Fastify[Backend Fastify Server]
        Fastify -->|Auth / Router / Controllers| Modules[Modules Logic]
        Fastify -->|WebSocket Gateway| SocketIO[Socket.IO Server]
        
        Modules -->|Zalo API / Event Listener| ZaloPool[Zalo Account Pool & zca-js Manager]
        ZaloPool -->|Encryption/Decryption| CryptoUtils[AES-256 Crypto Utils]
        
        Modules -->|Prisma Client ORM| Prisma[Prisma ORM]
    end

    subgraph Data Tier
        Prisma -->|Port 5432| Postgres[(PostgreSQL 16 DB)]
        ZaloPool -->|Remote Polling/Push| ZaloServer[Zalo Official Servers]
    end

    subgraph Backup System
        Cron[Backup Service Container] -->|pg_dump Daily| Postgres
    end
```

---

## 2. Các Thành Phần Chính (Core Components)

### 2.1. Web Frontend Layer (Vue 3 + Vuetify 4)
- **Công nghệ:** Vue 3 (Composition API, `<script setup>`), Vuetify 4 UI Framework, Pinia State Management, Vue Router, Chart.js, Socket.IO Client.
- **Vai trò:** Hiển thị giao diện người dùng, quản lý trạng thái client, nhận sự kiện real-time (tin nhắn mới, cập nhật danh bạ, trạng thái Zalo) để cập nhật DOM tức thì mà không cần reload trang.

### 2.2. API & WebSocket Server (Fastify + Socket.IO)
- **Fastify Framework:** Lựa chọn nhờ tốc độ xử lý vượt trội, hệ sinh thái plugin mạnh mẽ (`@fastify/jwt`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/static`).
- **Real-time Gateway:** Socket.IO tích hợp trực tiếp trên server HTTP của Fastify, xác thực kết nối bằng JWT Token.

### 2.3. Zalo Account Connection Pool (`ZaloPool`)
- **Quản lý đa phiên Zalo:** `ZaloPool` duy trì danh sách các thể hiện (instances) của thư viện `zca-js` cho từng tài khoản Zalo đang hoạt động.
- **Tự động khôi phục (Auto-reconnect):** Khi khởi động server, `ZaloPool` giải mã dữ liệu session (cookie, IMEI) từ DB và tự động tái lập kết nối với Zalo Server.

### 2.4. Data Storage & Persistence (PostgreSQL 16 + Prisma ORM)
- **PostgreSQL 16:** Cơ sở dữ liệu quan hệ chính lưu trữ thông tin Tổ chức, Người dùng, Tài khoản Zalo, Khách hàng, Cuộc trò chuyện, Tin nhắn, Lịch hẹn, Đơn hàng và Nhật ký hoạt động.
- **Prisma 7 ORM:** Quản lý Schema, khởi tạo Migration và tương tác dữ liệu an toàn phòng chống SQL Injection.

---

## 3. Luồng Dữ Liệu & Xử Lý Sự Kiện (Data Flows)

### 3.1. Luồng Tin nhắn Đến (Incoming Message Flow)
```mermaid
sequenceDiagram
    autonumber
    actor User as Khách hàng Zalo
    participant Zalo as Zalo Server
    participant Pool as ZaloPool (zca-js)
    participant Fastify as Fastify Backend
    participant DB as PostgreSQL DB
    participant WS as Socket.IO Server
    actor Agent as Sale Agent (Browser)

    User->>Zalo: Gửi tin nhắn mới
    Zalo->>Pool: Event: incoming_message
    Pool->>Fastify: Chuyển tiếp payload tin nhắn
    Fastify->>DB: Lưu tin nhắn & Cập nhật Conversation (unread_count++)
    Fastify->>WS: Emit event 'message:new' tới room 'org:{orgId}'
    WS->>Agent: Hiển thị tin nhắn mới & Thông báo âm thanh
```

### 3.2. Luồng Mã Hóa & Bảo Mật Phiên Zalo (Session Encryption Flow)
1. Khi người dùng quét mã QR thành công, `zca-js` trả về đối tượng `sessionData` chứa `cookie`, `imei`, `userAgent`.
2. Hệ thống gọi `encryptData(sessionData, ENCRYPTION_KEY)` mã hóa chuỗi JSON thành binary bằng thuật toán `AES-256-GCM` với IV ngẫu nhiên và Auth Tag.
3. Chuỗi mã hóa được lưu vào cột `session_data` trong bảng `zalo_accounts`.
4. Khi khởi động lại hệ thống, hàm `decryptData` sử dụng `ENCRYPTION_KEY` để giải mã dữ liệu an toàn.

---

## 4. Bảo Mật Kiến Trúc (Security Architecture)

- **Cô Lập Mạng (Network Isolation):** Fastify lắng nghe trong container; Docker chỉ publish cổng ứng dụng và PostgreSQL lên loopback của host. Nginx/Cloudflare Tunnel là lớp tiếp nhận traffic public.
- **Bảo Mật Quyền Truy Cập (Multi-Tenant Isolation):** Invariant bắt buộc là mọi truy vấn đọc/ghi phải lọc theo `request.user.orgId` hoặc `orgId` suy ra từ API key đã xác thực.
- **Kiểm Soát Quyền Truy Cập Zalo (ACL):** Bảng `zalo_account_access` là nguồn quyền cho member trên REST và Socket.IO; owner/admin có thể bypass trong phạm vi organization của mình.
- **Contact Visibility:** Mọi role trong cùng organization được xem contact. `assignedUserId` phục vụ phân công/KPI, không phải ranh giới đọc dữ liệu.
- **AI Reports:** Mọi role được sử dụng; member bị giới hạn theo Zalo account ACL, còn owner/admin có phạm vi toàn organization và quản lý cấu hình SMTP/automation.

### 4.1. Trạng thái kiểm chứng ngày 2026-08-31

Các invariant trên là thiết kế đích, chưa được thực thi nhất quán. Audit hiện tại xác nhận còn thiếu tenant/RBAC/ACL ở một số route Orders, Zalo, Chat, AI Reports và account-room subscription của Socket.IO. Webhook/attachment downloader cũng chưa có SSRF guard hoàn chỉnh. Không coi hệ thống là production-hardened cho đến khi các release blocker trong roadmap được đóng bằng regression test.
