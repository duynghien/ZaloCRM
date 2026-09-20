<template>
  <v-menu offset-y :close-on-content-click="false" max-width="420" min-width="380">
    <template #activator="{ props: menuProps }">
      <v-btn
        icon
        size="small"
        class="topbar-action-btn"
        title="Thông báo"
        v-bind="menuProps"
      >
        <v-badge
          :content="store.unreadCount"
          :model-value="store.hasUnread"
          color="error"
          location="top end"
          offset-x="-2"
          offset-y="-2"
        >
          <v-icon size="18">bell-alt-1.svg</v-icon>
        </v-badge>
      </v-btn>
    </template>

    <v-card class="notification-card" elevation="0">
      <!-- Header -->
      <div class="notification-header d-flex align-center justify-space-between pa-3">
        <div class="d-flex align-center" style="gap: 8px;">
          <span class="neo-subtitle">Thông báo</span>
          <v-chip
            v-if="store.hasUnread"
            size="x-small"
            color="error"
            variant="flat"
            rounded="pill"
            class="notification-count-chip"
          >
            {{ store.unreadCount }}
          </v-chip>
        </div>
        <v-btn
          v-if="store.hasUnread"
          variant="text"
          size="x-small"
          color="primary"
          class="text-none mark-all-btn"
          @click.stop="store.markAllAsRead()"
        >
          <v-icon start size="14">mdi-check-all</v-icon>
          Đã đọc tất cả
        </v-btn>
      </div>

      <v-divider />

      <!-- Filter tabs -->
      <div class="d-flex pa-2" style="gap: 4px;">
        <v-btn
          size="small"
          :variant="store.filter === 'all' ? 'flat' : 'outlined'"
          :color="store.filter === 'all' ? 'primary' : undefined"
          rounded="lg"
          class="text-none filter-tab-btn"
          @click="store.setFilter('all')"
        >
          Tất cả
        </v-btn>
        <v-btn
          size="small"
          :variant="store.filter === 'unread' ? 'flat' : 'outlined'"
          :color="store.filter === 'unread' ? 'primary' : undefined"
          rounded="lg"
          class="text-none filter-tab-btn"
          @click="store.setFilter('unread')"
        >
          Chưa đọc
          <v-chip
            v-if="store.unreadCount > 0"
            size="x-small"
            color="error"
            variant="flat"
            rounded="pill"
            class="ml-1 notification-count-chip"
          >
            {{ store.unreadCount }}
          </v-chip>
        </v-btn>
      </div>

      <v-divider />

      <!-- Loading -->
      <v-progress-linear v-if="store.loading" indeterminate color="primary" height="2" />

      <!-- Notification list -->
      <div class="notification-list" style="max-height: 360px; overflow-y: auto;">
        <template v-if="store.filteredNotifications.length > 0">
          <div
            v-for="n in store.filteredNotifications"
            :key="n.id"
            class="notification-item d-flex align-start pa-3"
            :class="{ 'notification-unread': !n.isRead }"
            @click="handleClick(n)"
          >
            <!-- Icon -->
            <v-avatar
              size="36"
              :color="getTypeColor(n) + '-lighten-5'"
              class="notification-icon-avatar mr-3 flex-shrink-0"
            >
              <v-icon :color="getTypeColor(n)" size="18">
                {{ getCategoryIcon(n.category) }}
              </v-icon>
            </v-avatar>

            <!-- Content -->
            <div class="flex-grow-1 overflow-hidden">
              <div class="d-flex align-center" style="gap: 6px;">
                <v-chip
                  size="x-small"
                  :color="getTypeColor(n)"
                  variant="outlined"
                  rounded="pill"
                  class="notification-category-chip"
                >
                  {{ getCategoryLabel(n.category) }}
                </v-chip>
                <span v-if="!n.isRead" class="notification-unread-dot"></span>
              </div>
              <div class="text-body-2 font-weight-medium mt-1 text-truncate">{{ n.title }}</div>
              <div class="text-caption text-medium-emphasis mt-0.5 text-truncate">{{ n.detail }}</div>
              <div class="text-caption text-disabled mt-1">{{ formatTime(n.createdAt) }}</div>
            </div>

            <!-- Actions -->
            <div class="d-flex flex-column ml-2 flex-shrink-0" style="gap: 2px;">
              <v-btn
                v-if="!n.isRead"
                icon
                size="x-small"
                variant="text"
                color="success"
                title="Đánh dấu đã đọc"
                @click.stop="store.markAsRead(n.id)"
              >
                <v-icon size="14">mdi-check</v-icon>
              </v-btn>
              <v-btn
                icon
                size="x-small"
                variant="text"
                color="error"
                title="Xóa"
                @click.stop="store.deleteNotification(n.id)"
              >
                <v-icon size="14">mdi-close</v-icon>
              </v-btn>
            </div>
          </div>
        </template>

        <div v-else class="pa-6 text-center">
          <v-icon size="40" color="grey-lighten-1" class="mb-2">mdi-bell-check-outline</v-icon>
          <div class="text-caption text-medium-emphasis">
            {{ store.filter === 'unread' ? 'Không có thông báo chưa đọc' : 'Không có thông báo' }}
          </div>
        </div>
      </div>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useNotificationStore } from '@/stores/notification';

const store = useNotificationStore();
const router = useRouter();

onMounted(() => {
  store.initSocket();
});

onUnmounted(() => {
  // Don't disconnect socket on unmount since it should persist across navigation
  // Socket is managed by the store lifecycle
});

function handleClick(n: any) {
  if (!n.isRead) store.markAsRead(n.id);
  // Safe navigation: only allow internal relative paths
  if (n.actionUrl && n.actionUrl.startsWith('/') && !n.actionUrl.startsWith('//')) {
    router.push(n.actionUrl);
  }
}

function getTypeColor(n: any): string {
  if (n.type === 'error' || (n.type === 'warning' && n.category === 'zalo_account')) return 'error';
  if (n.type === 'warning') return 'warning';
  if (n.type === 'ai_alert') return 'purple';
  if (n.type === 'success') return 'success';
  return 'info';
}

function getCategoryIcon(category: string): string {
  switch (category) {
    case 'appointment': return 'mdi-calendar-clock';
    case 'chat_sla': return 'mdi-message-alert';
    case 'zalo_account': return 'mdi-connection';
    case 'copilot': return 'mdi-robot';
    case 'system': return 'mdi-information';
    default: return 'mdi-bell';
  }
}

function getCategoryLabel(category: string): string {
  switch (category) {
    case 'appointment': return 'Lịch hẹn';
    case 'chat_sla': return 'Chờ phản hồi';
    case 'zalo_account': return 'Kết nối';
    case 'copilot': return 'AI Copilot';
    case 'system': return 'Hệ thống';
    default: return 'Thông báo';
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'Vừa xong';
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours} giờ trước`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} ngày trước`;
  return date.toLocaleDateString('vi-VN');
}
</script>

<style scoped>
.notification-card {
  border: 1.5px solid var(--border-color) !important;
  border-radius: 12px !important;
  background: rgb(var(--v-theme-surface)) !important;
  box-shadow: none !important;
}

.notification-header {
  border-bottom: none;
}

.neo-subtitle {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 800;
  font-size: 0.85rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
}

.notification-count-chip {
  font-family: 'Space Grotesk', sans-serif !important;
  font-weight: 700 !important;
  font-size: 0.6rem !important;
  height: 18px !important;
  min-width: 18px !important;
  padding: 0 5px !important;
  border: 1.5px solid var(--border-color) !important;
}

.filter-tab-btn {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 0.75rem;
  height: 30px !important;
  border: 1.5px solid var(--border-color) !important;
}

.filter-tab-btn:active {
  transform: translate(1px, 1px) !important;
}

.mark-all-btn {
  font-family: 'Space Grotesk', sans-serif;
  font-weight: 600;
  font-size: 0.7rem;
}

.mark-all-btn:active {
  transform: translate(1px, 1px) !important;
}

.notification-item {
  cursor: pointer;
  transition: background-color 0.1s ease;
  border-bottom: 1px solid rgba(var(--v-border-color), 0.08);
}

.notification-item:hover {
  background-color: rgba(var(--v-theme-primary), 0.04);
}

.notification-item:active {
  transform: translate(1px, 1px) !important;
}

.notification-unread {
  background-color: rgba(var(--v-theme-primary), 0.03);
}

.notification-icon-avatar {
  border: 1.5px solid var(--border-color) !important;
}

.notification-category-chip {
  font-family: 'Space Grotesk', sans-serif !important;
  font-weight: 700 !important;
  font-size: 0.55rem !important;
  text-transform: uppercase !important;
  letter-spacing: 0.05em !important;
  height: 18px !important;
  border-width: 1.5px !important;
}

.notification-unread-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: rgb(var(--v-theme-primary));
  display: inline-block;
}

:deep(.v-badge__badge) {
  font-family: 'Space Grotesk', sans-serif !important;
  font-size: 0.65rem !important;
  font-weight: 700 !important;
  height: 16px !important;
  min-width: 16px !important;
  padding: 0 4px !important;
  border: 1px solid var(--border-color) !important;
}
</style>
