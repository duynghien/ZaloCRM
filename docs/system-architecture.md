# ZaloCRM — System Architecture & Design Specification

## 1. High-Level System Architecture

Hệ thống **ZaloCRM** được thiết kế theo kiến trúc Monolith hiện đại, chia tách rõ ràng giữa Frontend (Vue 3 Single Page Application) và Backend (Node.js Fastify REST API + WebSocket Server), lưu trữ dữ liệu tập trung trên cơ sở dữ liệu quan hệ PostgreSQL 16.

```mermaid
graph TD
    Client[Browser / Frontend Vue 3 App] -->|HTTPS / REST API| Nginx[Nginx / Cloudflare Reverse Proxy]
    Client -->|WSS / Socket.IO| Nginx
    
    subgraph Host / Docker Environment
        Nginx -->|Loopback 127.0.0.1:3080| Fastify[Backend Fastify 5 Server (Port 3000 in container)]
        Fastify -->|Auth / Router / Controllers| Modules[Modules Logic]
        Fastify -->|WebSocket Gateway| SocketIO[Socket.IO Server]
        
        Modules -->|Zalo API / Event Listener| ZaloPool[Zalo Account Pool & zca-js Manager]
        ZaloPool -->|Encryption/Decryption| CryptoUtils[AES-256 Crypto Utils]
        
        Modules -->|Prisma Client ORM| Prisma[Prisma 7 ORM]
    end

    subgraph Data Tier
        Prisma -->|Port 5432 / 127.0.0.1:5433| Postgres[(PostgreSQL 16 DB)]
        ZaloPool -->|Remote Push/Poll| ZaloServer[Zalo Official Servers]
    end

    subgraph Backup System
        Cron[Backup Service Container] -->|pg_dump Daily| Postgres
    end
```

---

## 2. Các Thành Phần Chính (Core Components)

### 2.1. Web Frontend Layer (Vue 3 + Vuetify 4 + Neo-Brutalism CQA)
- **Công nghệ & Phong cách:** Vue 3 (Composition API, `<script setup>`), Vuetify 4 UI Framework, Pinia State Management, Vue Router, Chart.js, Socket.IO Client.
- **Ngôn ngữ Thiết kế Neo-Brutalism chuẩn CQA:** Triệt tiêu hoàn toàn bóng mờ ảo (100% Zero Shadow), đường viền cơ học 1.5px dứt khoát, phản hồi click xúc giác (`translate(1px, 1px)`), bán kính bo góc chuẩn CQA (12px card/dialog/table/chat bubble, 8px button/input/icon-box, 9999px pill badge). Hệ thống biểu tượng Custom SVG Icons độc lập (`custom-icons.ts`) và Brand SVG Icons chính hãng cho các AI provider.
- **Thanh Điều Hướng Đa Tài Khoản Dọc (`AccountRail.vue`):** Cho phép chuyển đổi tức thì giữa các tài khoản Zalo chỉ với 1 click, hiển thị viền màu đại diện (`colorTag`), nhãn chi nhánh (`branchTag`), trạng thái live và badge đếm tin nhắn chưa đọc tổng hợp.
- **Vai trò:** Hiển thị giao diện người dùng, quản lý trạng thái client, nhận sự kiện real-time (tin nhắn mới, cập nhật danh bạ, trạng thái Zalo) để cập nhật DOM tức thì mà không cần reload trang. Token JWT ngắn hạn được giữ hoàn toàn trong RAM client (`session.ts`), không ghi vào bộ nhớ bền vững.

### 2.2. API & WebSocket Server (Fastify + Socket.IO)
- **Fastify Framework:** Lựa chọn nhờ tốc độ xử lý vượt trội, hệ sinh thái plugin mạnh mẽ (`@fastify/jwt`, `@fastify/cors`, `@fastify/rate-limit`, `@fastify/static`, `@fastify/cookie`).
- **Real-time Gateway:** Socket.IO tích hợp trực tiếp trên server HTTP của Fastify, xác thực kết nối bằng JWT Token chứa `sessionId` và kiểm tra trạng thái session thực trong PostgreSQL.
- **App factory:** `backend/src/app-factory.ts` dựng cùng HTTP routes và Socket.IO production cho ứng dụng và integration fixture; entrypoint `app.ts` sở hữu việc khởi động worker, cron và Zalo listeners.

### 2.3. Zalo Account Connection Pool (`ZaloPool`)
- **Quản lý đa phiên Zalo:** `ZaloPool` duy trì danh sách các thể hiện (instances) của thư viện `zca-js` cho từng tài khoản Zalo đang hoạt động.
- **Tự động khôi phục (Auto-reconnect):** Khi khởi động server, `ZaloPool` giải mã dữ liệu session (cookie, IMEI) từ DB và tự động tái lập kết nối với Zalo Server, có cơ chế giãn cách (stagger 10s) tránh rate limit.

### 2.4. Data Storage & Persistence (PostgreSQL 16 + Prisma 7 ORM)
- **PostgreSQL 16:** Cơ sở dữ liệu quan hệ chính với 22 Data Models phân tách theo nghiệp vụ:
  - *Đa tổ chức & Người dùng:* `Organization`, `Team`, `User`
  - *Phiên xác thực bền vững:* `AuthSession` (lưu SHA-256 hash của refresh token, quản lý xoay vòng và family revocation)
  - *Tài khoản Zalo & Phân quyền:* `ZaloAccount` (hỗ trợ `branchTag`, `colorTag`, lưu session mã hóa AES-256-GCM), `ZaloAccountAccess` (quyền read, chat, admin)
  - *Khách hàng & Hội thoại:* `Contact`, `Conversation`, `Message` (hỗ trợ deduplication theo `conversationId_zaloMsgId`)
  - *Lịch hẹn:* `Appointment`
  - *Đơn hàng & Cấp mã tuần tự:* `Order`, `OrderCodeCounter` (cấp mã nguyên tử theo org/ngày UTC)
  - *Báo cáo Điều hành AI Digest v2:* `GroupReportConfig`, `GeneratedReport`, `AiReportJob`, `AiReportJobDispatch`, `AiReportBudgetReservation`, `AiReportResend`, `AiReportResendDispatch`
  - *Vận hành & Kiểm toán:* `AppSetting` (mã hóa AES-256-GCM các secret), `DailyMessageStat`, `ActivityLog`
- **Prisma 7 ORM:** Quản lý Schema, khởi tạo Migration có version và tương tác dữ liệu an toàn phòng chống SQL Injection. Tương thích schema được kiểm chứng lúc khởi động bằng `schemaIsCompatible()`.

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
    Fastify->>WS: emitAccountEvent(accountId, 'chat:message', payload)
    WS->>DB: Đọc account org và session/ACL hiện tại của từng ứng viên
    DB-->>WS: Identity cùng org, có quyền read
    Note over WS: Kiểm tra invalidation/session lần cuối rồi emit từng socket
    WS->>Agent: Hiển thị tin nhắn mới & Thông báo âm thanh
```

Room `org:{orgId}` chỉ chọn ứng viên, không cấp quyền nhận payload. Chat/status cần session DB hợp lệ và quyền `read` hiện tại trên account; không yêu cầu subscribe. Owner/Admin bypass grant chỉ trong organization của mình. Thiếu account/context hoặc lỗi kiểm tra DB thì từ chối gửi, không fallback broadcast toàn cục.

### 3.1.1. QR, reminder và khôi phục realtime

- `zalo:qr`, `zalo:qr-expired`, `zalo:scanned` cần quyền account `admin` hiện tại và intent subscribe còn hiệu lực ở server. Client chờ ack `zalo:subscribe` thành công trước HTTP login; reconnect khôi phục intent của dialog còn mở, unsubscribe/cancel vô hiệu hóa yêu cầu đang chờ.
- `appointment:reminder` dùng `apt.orgId` đọc từ DB và kiểm tra session/org của từng người nhận qua `emitOrganizationEvent`. Visibility vẫn toàn organization, kể cả người không được assign; cập nhật reminder flag theo cả `id` và `orgId`.
- Account delivery được tuần tự hóa theo account, giới hạn 100 sự kiện đang giữ; overflow gộp tín hiệu `realtime:resync-required` chỉ chứa reason/generation. Frontend tải lại conversation list và conversation đang mở qua REST khi có tín hiệu hoặc reconnect, gộp fetch và dùng ACL hiện hành để loại dữ liệu không còn quyền. Queue này không phải durable event log.
- ACL/account mutation vô hiệu hóa thao tác đang chờ trước response thành công; session revoke vô hiệu hóa cả handshake đang chờ. Delivery kiểm tra lại trạng thái ngay trước emit, không giữ cache quyền dương lâu dài.
- Bảo đảm invalidation hiện giới hạn **một backend process với Socket.IO default adapter**. Cần shared invalidation và kiểm chứng riêng trước khi dùng nhiều replica/distributed adapter.

### 3.1.2. Message replay, self-listen và thu hồi

- **Self-listen từ thiết bị ngoài:** Zalo SDK khởi tạo với `selfListen: true` để lắng nghe tin nhắn gửi từ iPad/điện thoại (`isSelf: true`). Listener bỏ qua self-reaction/typing, tự động tra cứu thông tin người nhận (`getUserInfo` timeout 3s) và đồng bộ real-time lên Dashboard (`senderType: 'self'`).
- **Deduplication & Race Condition:** Trích xuất `zaloMsgId` đa tầng từ response `sendMessage`. Nếu WebSocket echo dội về trước khi API route lưu DB, route bắt lỗi `P2002` và cập nhật lại `repliedByUserId` cùng `senderName` của nhân viên.
- **Tự lành hội thoại & Contact:** Hội thoại có `contactId: null` tự động liên kết với Contact khi có tin nhắn mới. Khi khách hàng phản hồi, tên Contact tự động cập nhật từ tên thật trên Zalo nếu trước đó là tên mặc định ('Khách Zalo').
- **Rate Limit Pacing:** Cache dedup `zaloMsgId` (TTL 60s) chống đếm x2. Tin nhắn từ iPad chỉ tính vào hạn mức ngày (200 tin/ngày), không làm kẹt nhịp gửi (burst 3 tin/30s, delay 2s) của nhân viên trên Dashboard. Hỗ trợ tham số `force: true` gửi khẩn cấp khi vượt 200 tin/ngày.
- **Message replay & Undo:** Transaction ingestion khóa hội thoại và unique `(conversationId, zaloMsgId)` để một sự kiện phát lại không tạo message, tăng unread, tải attachment, phát socket hoặc webhook lần nữa. Undo tìm conversation bằng org/account/thread trước khi cập nhật message (`isDeleted: true`, `deletedAt: new Date()`); cùng mã tin nhắn ở hội thoại khác không bị thu hồi theo.

### 3.1.3. Nguồn AI, ngân sách và delivery

Generate resolve từng cặp account/thread thành snapshot `(orgId, zaloAccountId, groupThreadId, conversationId)` bất biến. Selector chỉ có thread được hỗ trợ khi duy nhất trong org; mơ hồ trả `409`. Job v2, archive và cấu hình dùng cùng định danh nguồn. Đọc cần quyền `read`; generate/delivery cần quyền `chat`, cấu hình nhóm cần `admin`. Sender là account được chọn tường minh, không dùng account kết nối đầu tiên.

Worker kiểm tra ngân sách trước từng provider attempt, bao gồm attachment-expanded context, map/reduce/final và retry. Reservation được persist với lease fence để recovery không đặt lại ngân sách. Trước mỗi Zalo part và email send, guard kiểm tra quyền hiện tại và ownership/cancellation/lease tương ứng; request SDK đã bắt đầu không thể thu hồi.

Resend lưu attempt và dispatch ledger dưới idempotency key; replay trả ledger, không gửi lại. Kết quả partial/uncertain phải đối soát người nhận trước khi người dùng tạo lượt mới. Hệ thống không bảo đảm exactly-once đối với dịch vụ gửi bên ngoài.

Cutover giữ config không resolve ở `needs_resolution`, không chạy lịch cho nguồn đó; report cũ `legacy_unverified` chỉ Owner/Admin cùng org đọc và không resend. Job v1 chưa terminal chuyển failed, giữ payload/result và ledger claimed/sent; không tự khởi chạy lại. Shutdown đóng admission rồi chờ producer/cron/worker/send trước migration; timeout chặn cutover. Xem [deployment guide](deployment-guide.md).

### 3.1.4. Luồng Cấp Mã Đơn Hàng Nguyên Tử (Atomic Order Code Flow)

```mermaid
sequenceDiagram
    autonumber
    actor Client as User / API
    participant Fastify as Order Controller
    participant DB as PostgreSQL Transaction
    participant Counter as order_code_counters

    Client->>Fastify: POST /api/v1/orders { contactId, totalAmount, ... }
    Fastify->>DB: BEGIN Transaction
    Fastify->>Counter: INSERT INTO order_code_counters (org_id, date_key, last_value) ON CONFLICT DO UPDATE SET last_value = last_value + 1 RETURNING last_value
    Counter-->>Fastify: last_value (BigInt)
    Note over Fastify: Sinh mã ORD-YYYYMMDD-NNN (ví dụ ORD-20260913-001)
    Fastify->>DB: INSERT INTO orders (id, org_id, contact_id, order_code, ...)
    Fastify->>DB: COMMIT Transaction
    Fastify-->>Client: 201 Created { id, orderCode, ... }
```

- Mã đơn hàng được tạo nguyên tử trong cùng transaction tạo bản ghi `Order`. Lệnh `INSERT INTO order_code_counters ... ON CONFLICT DO UPDATE` khóa dòng theo cặp `(org_id, date_key)` (ngày tính theo chuẩn UTC `YYYYMMDD`), bảo đảm không có race condition hay trùng mã khi nhiều nhân viên tạo đơn cùng lúc.
- Khóa Unique `(org_id, order_code)` ở mức database đóng vai trò chốt chặn cuối cùng bảo vệ toàn vẹn dữ liệu.

### 3.1.5. Động cơ AI Đa Nhà Cung Cấp (Multi-Provider Engine), SSRF, Burst Sampling & Two-Tier Verification

- **Bộ điều phối thích ứng (AiProviderRouter):** Trừu tượng hóa các adapter AI độc lập (`GeminiProvider`, `OpenAiCompatibleProvider` cho OpenAI, DeepSeek và Custom AI Gateway). Hỗ trợ cấu hình động theo từng tổ chức hoặc kế thừa cấu hình mặc định an toàn từ hệ thống.
- **Duy nhất một lần đặt trước ngân sách (Single-Layer Budget Reservation):** Khi tiến hành failover sang provider tiếp theo trong chuỗi dự phòng (`fallbackChain`), router tái sử dụng cùng một `attemptKey` đã đặt trước với `ReportJobBudget`. Ngân sách token chỉ được hoàn tất (`complete`) một lần khi một provider thành công, loại bỏ hoàn toàn nguy cơ nhân đôi chi phí (double-reserve) hoặc làm cạn kiệt ngân sách của tổ chức.
- **Cơ chế phòng chống SSRF trên AI Gateway:** Mọi Base URL tùy chỉnh của bên thứ ba khi lưu hoặc kiểm tra kết nối đều phải vượt qua `validateAiGatewayUrl`. Hệ thống mặc định bắt buộc giao thức HTTPS và phân giải DNS nhằm chặn mọi dải IP loopback, private (RFC1918) và link-local. Việc kết nối tới AI Gateway mạng cục bộ (Ollama, vLLM, LocalAI) chỉ được chấp thuận khi cờ môi trường `ALLOW_PRIVATE_AI_GATEWAYS=true` được cấu hình tường minh.
- **Cầu nối thị giác lai thông minh (Smart Hybrid Vision Bridge):** Với các mô hình thuần văn bản (như DeepSeek-V3), `preprocessMultimodalPrompt` tự động điều phối ảnh tới provider thị giác khả dụng để OCR trích xuất số liệu/chứng từ, hoặc tự động suy thoái nhẹ nhàng (graceful degradation) chèn ghi chú placeholder thay vì làm gián đoạn toàn bộ tiến trình tổng hợp báo cáo.
- **Bộ lấy mẫu ảnh cụm thông minh (Multimodal Burst Sampling):**
  - Khử trùng lặp ảnh ứng viên theo Base URL (`attachment-burst-sampler.ts`), loại bỏ các ảnh trùng lặp do gửi lặp hoặc chia sẻ lại.
  - Khử độc ngữ cảnh văn bản đi kèm trước mỗi ảnh, vô hiệu hóa các mẫu prompt injection tiềm ẩn trong tin nhắn nhóm chat.
  - Chiến lược Burst Sampling: Lấy mẫu 100% nếu cụm ảnh <= 3 ảnh; tự động lấy mẫu đại diện [ảnh đầu, ảnh giữa, ảnh cuối] nếu cụm ảnh > 3 ảnh.
  - Pool 4 worker xử lý tải đồng thời, kèm bộ đệm chống va chạm (anti-collision cache) và chốt chặn cứng 12MB tổng tải trọng hình ảnh.
- **Kiểm chứng chéo 2 tầng & Phát sóng Nhiệm vụ (Two-Tier Cross-Verification & Action Items):**
  - **Tier 1 (Section 6 Directive):** Chỉ thị hệ thống bắt buộc LLM đối chiếu dữ liệu văn bản và bằng chứng hình ảnh (phát hiện báo cáo khống, biên bản không khớp).
  - **Tier 2 (High Priority Action Items):** Phân tích và trích xuất bảng nhiệm vụ hành động (`report-action-item-parser.ts`), cập nhật trạng thái nhiệm vụ trực tiếp (`PUT /api/v1/ai-reports/:id/tasks/:taskId`) và phát sóng tức thì các nhiệm vụ ưu tiên cao sang nhóm Zalo hoặc người phụ trách (`POST /api/v1/ai-reports/:id/broadcast-tasks` qua `formatTasksForZaloMessage`).
- **Cô lập & mã hóa cấu hình đa người dùng:** Dữ liệu cấu hình và API key của từng tổ chức được mã hóa `AES-256-GCM` trong bảng `AppSetting` (`settingKey: 'ai_provider_config'`). API DTO luôn che giấu (`maskKey`) các secret và tuyệt đối không làm lộ khóa cấu hình cấp hệ thống của máy chủ cho client.

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

### 4.1. Ghi nhận lịch sử ngày 2026-09-02

Nội dung dưới đây giữ ghi nhận của đợt remediation cũ, **không phải bằng chứng nghiệm thu hiện tại**. Thay đổi realtime/test harness ngày 2026-09-08 vẫn phải hoàn tất ma trận kiểm chứng trong [Phase 1](../plans/260902-1756-post-remediation-audit-fixes/phase-01-start.md); các thay đổi hiện tại được mô tả phía trên, release toàn bộ vẫn chờ bằng chứng revision cuối.

Release remediation đã đưa tenant scoping, RBAC/ACL Zalo, session rotation và SSRF policy vào các ranh giới backend. Access token có hạn 15 phút và chỉ tồn tại trong memory của browser; refresh token opaque được hash ở server, xoay vòng qua HttpOnly cookie, và bị revoke khi đổi mật khẩu, role hoặc trạng thái hoạt động. Socket.IO tái kiểm tra session và quyền account trong lúc kết nối còn sống.

AI report on-demand chạy qua DB-backed job (giới hạn 31 ngày, 20 group, 10 email recipients; idempotency, lease, cancellation và ngân sách message/token). Webhook và attachment chỉ được phép tới HTTPS public sau DNS/redirect validation. SMTP password và webhook secret được mã hóa; public API key vẫn plaintext/recoverable theo residual-risk waiver, chỉ Owner/Admin xem được, `no-store`, audit và không log giá trị key.

Vitest bảo vệ các policy/contract P1 và Playwright smoke kiểm tra browser không lưu bearer token bền vững. GitHub Actions chạy cùng root workspace install, typecheck, test, build, production audit, frontend smoke và Docker build.
