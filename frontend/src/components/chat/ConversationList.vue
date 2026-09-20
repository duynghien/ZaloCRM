<template>
  <div class="conversation-list d-flex flex-column" style="width: 100%; border-right: 1.5px solid var(--border-color); height: 100%;">
    <!-- Active Account Filter Banner -->
    <div
      v-if="selectedAccount"
      class="account-filter-banner px-3 py-2 d-flex align-center justify-space-between"
      :style="{
        backgroundColor: activeAccountBg,
        borderBottom: '1.5px solid var(--border-color)',
      }"
    >
      <div class="d-flex align-center text-truncate mr-2">
        <span class="text-caption mr-1 font-weight-medium">Đang xem:</span>
        <span
          class="font-weight-bold text-caption text-truncate"
          :style="{ color: activeAccountColor }"
        >
          {{ selectedAccount.displayName || selectedAccount.phone || 'Zalo' }}
        </span>
        <span
          v-if="selectedAccount.branchTag"
          class="neo-pill ml-1 px-1 py-0 text-caption font-weight-bold"
          :style="{
            backgroundColor: activeAccountColor,
            color: '#FFFFFF',
            fontSize: '0.65rem !important'
          }"
        >
          {{ selectedAccount.branchTag }}
        </span>
      </div>
      <v-btn
        size="x-small"
        variant="text"
        icon="mdi-close"
        title="Xem tất cả tài khoản"
        @click="$emit('clear-account-filter')"
      />
    </div>

    <!-- Search text field -->
    <div class="pa-2">
      <v-text-field
        :model-value="search"
        @update:model-value="$emit('update:search', $event)"
        placeholder="Tìm kiếm hội thoại..."
        prepend-inner-icon="search-alt-1.svg"
        variant="outlined"
        rounded="lg"
        density="compact"
        hide-details
        clearable
      />
    </div>

    <!-- Conversations List -->
    <v-list class="flex-grow-1 overflow-y-auto pa-0" density="compact">
      <v-progress-linear v-if="loading" indeterminate color="primary" />

      <v-list-item
        v-for="conv in conversations"
        :key="conv.id"
        :active="conv.id === selectedId"
        @click="$emit('select', conv.id)"
        class="py-2 conversation-item"
        :class="{ 'conversation-active': conv.id === selectedId, 'unread-conversation': conv.unreadCount > 0 && conv.id !== selectedId }"
      >
        <template #prepend>
          <div class="position-relative mr-3">
            <v-avatar size="42" color="grey-lighten-2" rounded="circle" style="border: 1.5px solid var(--border-color);">
              <v-icon v-if="conv.threadType === 'group'" icon="mdi-account-group" />
              <v-img v-else-if="conv.contact?.avatarUrl" :src="conv.contact.avatarUrl" />
              <v-icon v-else icon="user-alt.svg" />
            </v-avatar>
            <!-- Sub-badge for Zalo account color -->
            <span
              v-if="conv.zaloAccount"
              class="account-sub-badge"
              :style="{
                backgroundColor: getConvAccountColor(conv),
              }"
              :title="conv.zaloAccount.displayName || 'Zalo'"
            />
          </div>
        </template>

        <v-list-item-title class="d-flex align-center">
          <span class="text-truncate" :class="{ 'font-weight-bold': conv.unreadCount > 0 }">
            {{ conv.threadType === 'group' ? (conv.contact?.fullName || 'Nhóm') : (conv.contact?.fullName || 'Khách hàng') }}
          </span>
          <v-chip
            v-if="conv.threadType === 'group'"
            size="x-small"
            color="info"
            variant="tonal"
            rounded="pill"
            class="ml-1 neo-pill"
          >
            Nhóm
          </v-chip>
          <span
            v-if="hasAnomaly(conv)"
            class="neo-pill ml-1 px-1 py-0 text-caption font-weight-bold d-inline-flex align-center gap-1"
            style="background-color: #FEE2E2; color: #DC2626; border: 1px solid #EF4444; font-size: 0.65rem !important;"
            title="Cuộc trò chuyện có khiếu nại hoặc bức xúc cần xử lý"
          >
            <v-icon size="10" color="error">mdi-alert</v-icon>
            KHIẾU NẠI
          </span>
          <v-spacer />
          <span class="text-caption text-grey ml-1">{{ formatTime(conv.lastMessageAt) }}</span>
        </v-list-item-title>

        <v-list-item-subtitle class="d-flex align-center mt-1">
          <span class="text-truncate flex-grow-1 mr-2 d-inline-flex align-center" :class="{ 'font-weight-medium': conv.unreadCount > 0 }">
            <span v-if="getMessagePreview(conv).prefix" class="mr-1">{{ getMessagePreview(conv).prefix }}</span>
            <v-icon v-if="getMessagePreview(conv).icon" size="14" class="mr-1 text-grey flex-shrink-0">{{ getMessagePreview(conv).icon }}</v-icon>
            <span class="text-truncate">{{ getMessagePreview(conv).text }}</span>
          </span>
          <v-badge
            v-if="conv.unreadCount > 0"
            :content="conv.unreadCount > 99 ? '99+' : conv.unreadCount"
            color="error"
            inline
          />
        </v-list-item-subtitle>

        <!-- Brand / Account Pill indicator -->
        <template #append>
          <div v-if="conv.zaloAccount" class="d-flex flex-column align-end">
            <span
              v-if="conv.zaloAccount.branchTag"
              class="neo-pill px-1 py-0 font-weight-bold"
              :style="{
                backgroundColor: getConvAccountColor(conv),
                color: '#FFFFFF',
                fontSize: '0.62rem !important',
                maxWidth: '75px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }"
              :title="conv.zaloAccount.branchTag"
            >
              {{ conv.zaloAccount.branchTag }}
            </span>
            <span
              v-else-if="conv.zaloAccount.displayName"
              class="text-caption text-grey-darken-1 mt-0"
              style="font-size: 0.65rem; max-width: 65px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
              :title="conv.zaloAccount.displayName"
            >
              {{ conv.zaloAccount.displayName }}
            </span>
          </div>
        </template>
      </v-list-item>

      <div v-if="!loading && conversations.length === 0" class="text-center pa-8 text-grey">
        Chưa có cuộc trò chuyện nào
      </div>
    </v-list>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Conversation } from '@/composables/use-chat';
import type { ZaloAccount } from '@/composables/use-zalo-accounts';
import { getDeterministicAccountColor } from '@/utils/account-colors';
import { useChatCopilot } from '@/composables/use-chat-copilot';

const { activeAnomalyMap } = useChatCopilot();

function hasAnomaly(conv: Conversation): boolean {
  if (activeAnomalyMap.value.has(conv.id)) return true;
  const meta = conv.contact?.metadata as Record<string, any> | undefined;
  return meta?.escalationStatus === 'pending';
}

const props = defineProps<{
  conversations: Conversation[];
  selectedId: string | null;
  loading: boolean;
  search: string;
  selectedAccountId?: string | null;
  accounts?: ZaloAccount[];
}>();

defineEmits<{
  select: [id: string];
  'update:search': [value: string];
  'clear-account-filter': [];
}>();

const selectedAccount = computed(() => {
  if (!props.selectedAccountId || !props.accounts) return null;
  return props.accounts.find(a => a.id === props.selectedAccountId) || null;
});

const activeAccountColor = computed(() => {
  if (!selectedAccount.value) return '#0068FF';
  return getDeterministicAccountColor(selectedAccount.value.id, selectedAccount.value.colorTag);
});

const activeAccountBg = computed(() => {
  return 'var(--bg-main, #f8f9fa)';
});

function getConvAccountColor(conv: Conversation): string {
  if (!conv.zaloAccount) return '#0068FF';
  return getDeterministicAccountColor(conv.zaloAccount.id, conv.zaloAccount.colorTag);
}

interface MessagePreview {
  prefix?: string;
  icon?: string;
  text: string;
}

function getMessagePreview(conv: Conversation): MessagePreview {
  const msg = conv.messages?.[0];
  if (!msg) return { text: '' };
  if (msg.isDeleted) return { text: '(đã thu hồi)' };
  const prefix = msg.senderType === 'self' ? 'Bạn: ' : '';

  switch (msg.contentType) {
    case 'image': return { prefix, icon: 'mdi-image-outline', text: 'Hình ảnh' };
    case 'sticker': return { prefix, icon: 'mdi-sticker-emoji', text: 'Sticker' };
    case 'video': return { prefix, icon: 'mdi-video-outline', text: 'Video' };
    case 'voice': return { prefix, icon: 'mdi-microphone-outline', text: 'Tin nhắn thoại' };
    case 'gif': return { prefix, text: 'GIF' };
    case 'file': return { prefix, icon: 'mdi-paperclip', text: 'Tệp đính kèm' };
    case 'link': return { prefix, icon: 'mdi-link-variant', text: 'Liên kết' };
  }

  // Reminder/calendar messages
  if (msg.content) {
    try {
      const p = JSON.parse(msg.content);
      if (p.action === 'msginfo.actionlist' && p.title) {
        return { prefix, icon: 'mdi-calendar-clock', text: p.title.slice(0, 50) };
      }
    } catch { /* not JSON */ }
  }

  const text = msg.content || '';
  return { prefix, text: text.length > 50 ? text.slice(0, 50) + '...' : text };
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'Vừa xong';
  if (diffMins < 60) return `${diffMins} phút`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours} giờ`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays < 7) return `${diffDays} ngày`;

  return date.toLocaleDateString('vi-VN');
}
</script>

<style scoped>
.account-filter-banner {
  border-left: 4px solid v-bind(activeAccountColor);
}

.account-sub-badge {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid var(--surface-card, #ffffff);
  box-shadow: 0 0 1px rgba(0, 0, 0, 0.4);
}

.unread-conversation {
  background-color: var(--secondary-brand) !important;
  opacity: 0.9;
}
</style>
