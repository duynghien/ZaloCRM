<template>
  <div class="interactive-api-docs">
    <div class="mb-4">
      <h3 class="text-subtitle-1 font-weight-bold" style="font-family: 'Space Grotesk', sans-serif;">
        TÀI LIỆU TÍCH HỢP REST API & WEBHOOK
      </h3>
      <p class="text-caption text-medium-emphasis mb-0">Hướng dẫn xác thực header, chữ ký HMAC-SHA256 kép và danh mục endpoint</p>
    </div>

    <!-- Auth header guide -->
    <v-card elevation="0" class="neo-card pa-4 mb-4">
      <div class="text-subtitle-2 font-weight-bold mb-2">1. Xác Thực Public REST API</div>
      <p class="text-caption mb-2">Gửi kèm khóa API trong HTTP Header với mọi request:</p>
      <pre class="neo-code pa-3">X-API-Key: zcrm_your_secret_api_key_here</pre>
    </v-card>

    <!-- HMAC Verification Samples with Language Tabs -->
    <v-card elevation="0" class="neo-card pa-4 mb-4">
      <div class="text-subtitle-2 font-weight-bold mb-2">2. Kiểm Tra Chữ Ký Webhook (Chuẩn Kép V1 & V2)</div>
      <p class="text-caption mb-3">
        ZaloCRM gửi kèm header <code>X-Webhook-Signature-V2</code> và <code>X-Webhook-Timestamp</code>.
        Hãy kiểm tra cửa sổ dung sai thời gian 5 phút (300s) và so sánh chữ ký bằng hàm thời gian không đổi (timing-safe).
      </p>

      <v-tabs v-model="codeTab" density="compact" color="primary" class="mb-3">
        <v-tab value="node">Node.js</v-tab>
        <v-tab value="python">Python</v-tab>
        <v-tab value="php">PHP</v-tab>
        <v-tab value="curl">cURL</v-tab>
      </v-tabs>

      <v-window v-model="codeTab">
        <v-window-item value="node">
          <pre class="neo-code pa-3">{{ nodeSample }}</pre>
        </v-window-item>
        <v-window-item value="python">
          <pre class="neo-code pa-3">{{ pythonSample }}</pre>
        </v-window-item>
        <v-window-item value="php">
          <pre class="neo-code pa-3">{{ phpSample }}</pre>
        </v-window-item>
        <v-window-item value="curl">
          <pre class="neo-code pa-3">{{ curlSample }}</pre>
        </v-window-item>
      </v-window>
    </v-card>

    <!-- Endpoints Reference -->
    <v-card elevation="0" class="neo-card pa-4">
      <div class="text-subtitle-2 font-weight-bold mb-2">3. Danh Mục Public REST API Endpoints</div>
      <v-table density="compact" class="neo-table text-caption">
        <thead>
          <tr>
            <th>PHƯƠNG THỨC</th>
            <th>ENDPOINT</th>
            <th>QUYỀN HẠN (SCOPE)</th>
            <th>MÔ TẢ</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="ep in endpoints" :key="ep.path">
            <td>
              <v-chip size="x-small" :color="ep.method === 'GET' ? 'primary' : 'success'" variant="flat" class="font-weight-bold">
                {{ ep.method }}
              </v-chip>
            </td>
            <td><code class="font-mono">{{ ep.path }}</code></td>
            <td><v-chip size="x-small" variant="outlined">{{ ep.scope }}</v-chip></td>
            <td>{{ ep.desc }}</td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const codeTab = ref('node');

const nodeSample = `const crypto = require('crypto');

function verifyWebhook(rawBody, headers, secret) {
  const timestamp = headers['x-webhook-timestamp'];
  const signatureV2 = headers['x-webhook-signature-v2'];
  if (!timestamp || !signatureV2) return false;

  // 1. Chống Replay Attack: kiểm tra tolerance window 5 phút (300 giây)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

  // 2. Tính chữ ký V2: HMAC-SHA256("\${timestamp}.\${rawBody}", secret)
  const expected = crypto.createHmac('sha256', secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest('hex');

  // 3. So sánh an toàn thời gian không đổi (timing-safe)
  return crypto.timingSafeEqual(Buffer.from(signatureV2), Buffer.from(expected));
}`;

const pythonSample = `import hmac, hashlib, time

def verify_webhook(raw_body: str, timestamp: str, signature_v2: str, secret: str) -> bool:
    if abs(time.time() - int(timestamp)) > 300:
        return False  # Replay attack: lệch quá 5 phút
    message = f"{timestamp}.{raw_body}".encode('utf-8')
    expected = hmac.new(secret.encode('utf-8'), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature_v2, expected)`;

const phpSample = `function verifyWebhook($rawBody, $timestamp, $signatureV2, $secret) {
    if (abs(time() - intval($timestamp)) > 300) return false;
    $expected = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
    return hash_equals($signatureV2, $expected);
}`;

const curlSample = `# Gửi tin nhắn qua Public API:
curl -X POST https://your-domain.com/api/public/messages/send \\
  -H "X-API-Key: zcrm_your_api_key_here" \\
  -H "Content-Type: application/json" \\
  -d '{"conversationId": "conv-123", "content": "Xin chào từ hệ thống tích hợp"}'`;

const endpoints = [
  { method: 'GET', path: '/api/public/contacts', scope: 'contacts:read', desc: 'Danh sách khách hàng phân trang' },
  { method: 'POST', path: '/api/public/contacts', scope: 'contacts:write', desc: 'Tạo khách hàng mới' },
  { method: 'GET', path: '/api/public/orders', scope: 'orders:read', desc: 'Danh sách đơn hàng CRM' },
  { method: 'POST', path: '/api/public/orders', scope: 'orders:write', desc: 'Tạo đơn hàng kèm sản phẩm generic' },
  { method: 'GET', path: '/api/public/conversations', scope: 'messages:read', desc: 'Danh sách cuộc hội thoại Zalo' },
  { method: 'POST', path: '/api/public/messages/send', scope: 'messages:write', desc: 'Gửi tin nhắn Zalo tới khách' },
  { method: 'GET', path: '/api/public/appointments', scope: 'appointments:read', desc: 'Danh sách lịch hẹn' },
  { method: 'POST', path: '/api/public/appointments', scope: 'appointments:write', desc: 'Đặt lịch hẹn mới' },
  { method: 'GET', path: '/api/public/zalo-accounts', scope: 'zalo_accounts:read', desc: 'Danh sách tài khoản Zalo OA' },
];
</script>

<style scoped>
.neo-card {
  border: 1.5px solid var(--border-color);
  border-radius: 8px;
}
.neo-code {
  font-family: monospace;
  font-size: 11px;
  background: var(--surface-variant);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow-x: auto;
  white-space: pre-wrap;
}
.font-mono { font-family: monospace; }
</style>
