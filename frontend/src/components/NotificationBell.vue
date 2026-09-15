<template>
  <v-menu offset-y :close-on-content-click="false" max-width="380">
    <template #activator="{ props: menuProps }">
      <v-btn
        icon
        size="small"
        class="topbar-action-btn"
        title="Thông báo"
        v-bind="menuProps"
      >
        <v-badge
          :content="notifications.length"
          :model-value="notifications.length > 0"
          color="error"
          location="top end"
          offset-x="-2"
          offset-y="-2"
        >
          <v-icon size="18">bell-alt-1.svg</v-icon>
        </v-badge>
      </v-btn>
    </template>
    <v-card class="notification-card" style="max-height: 400px; overflow-y: auto;">
      <v-card-title class="text-body-1 font-weight-bold pa-3 neo-subtitle">Thông báo</v-card-title>
      <v-divider />
      <v-list density="compact" v-if="notifications.length > 0">
        <v-list-item
          v-for="n in notifications"
          :key="n.id"
          @click="handleClick(n)"
          class="py-2"
        >
          <template #prepend>
            <v-icon
              :color="n.type === 'error' ? 'red' : n.type === 'warning' ? 'orange' : 'blue'"
              size="20"
            >
              {{ n.type === 'error' ? 'mdi-alert-circle' : n.type === 'warning' ? 'mdi-alert' : 'mdi-information' }}
            </v-icon>
          </template>
          <v-list-item-title class="text-body-2 font-weight-medium">{{ n.title }}</v-list-item-title>
          <v-list-item-subtitle class="text-caption">{{ n.detail }}</v-list-item-subtitle>
        </v-list-item>
      </v-list>
      <div v-else class="pa-4 text-center text-caption text-grey">Không có thông báo</div>
    </v-card>
  </v-menu>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';

interface Notification {
  id: string;
  type: string;
  title: string;
  detail: string;
  priority: string;
}

const notifications = ref<Notification[]>([]);
const router = useRouter();
let interval: ReturnType<typeof setInterval>;

async function fetchNotifications() {
  try {
    const res = await api.get('/notifications');
    notifications.value = res.data.notifications || [];
  } catch {
    // silently ignore fetch errors
  }
}

function handleClick(n: Notification) {
  if (n.id === 'unreplied') router.push('/chat');
  else if (n.id.startsWith('apt-')) router.push('/appointments');
  else if (n.id.startsWith('zalo-')) router.push('/zalo-accounts');
  else if (n.id === 'tmr-apts') router.push('/appointments');
}

onMounted(() => {
  fetchNotifications();
  interval = setInterval(fetchNotifications, 60000);
});

onUnmounted(() => clearInterval(interval));
</script>

<style scoped>
.notification-card {
  border: 1.5px solid var(--border-color) !important;
  border-radius: 12px !important;
  background: var(--surface-card) !important;
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
