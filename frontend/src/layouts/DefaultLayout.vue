<template>
  <v-app>
    <!-- Top bar — CQA Neo-Brutalism bar -->
    <v-app-bar density="comfortable" flat class="app-top-bar">
      <v-app-bar-nav-icon @click="drawer = !drawer" />

      <!-- Brand Logo + Title: 💬aloCRM style -->
      <div class="d-flex align-center cursor-pointer ml-1" style="gap: 8px;" @click="router.push('/')">
        <div
          class="d-flex align-center justify-center neo-icon-box flex-shrink-0"
          style="width: 34px; height: 34px; background: #0068FF; color: #FFFFFF; border: 1.5px solid var(--border-color); border-radius: 8px;"
        >
          <v-icon size="20" color="#FFFFFF">mdi-message-processing</v-icon>
        </div>
        <v-app-bar-title class="ma-0 pa-0">
          <span class="font-weight-black brand-title" style="font-family: 'Space Grotesk', sans-serif; font-size: 1.25rem; letter-spacing: -0.5px;">
            <span style="color: var(--text-main);">Zalo</span><span style="color: #0068FF;">CRM</span>
          </span>
        </v-app-bar-title>
      </div>

      <!-- Global search -->
      <GlobalSearch class="mx-3 d-none d-sm-flex" />

      <v-spacer />

      <!-- Organization badge (Single-tenant) -->
      <div
        v-if="authStore.user?.orgName"
        class="d-none d-md-flex align-center px-3 py-1 mr-2 neo-pill"
        style="background: var(--surface-card); color: var(--text-main); font-size: 0.72rem; border-color: var(--border-color);"
      >
        <v-icon size="14" class="mr-1" color="primary">mdi-domain</v-icon>
        {{ authStore.user.orgName }}
      </div>

      <!-- Primary Action: + Kết nối Zalo (Admin/Owner guarded) -->
      <v-btn
        v-if="authStore.isAdmin"
        color="primary"
        size="small"
        class="font-weight-bold text-white mr-2 px-3 primary-cta-btn"
        rounded="lg"
        style="border: 1.5px solid var(--border-color); font-family: 'Space Grotesk', sans-serif; height: 36px;"
        @click="router.push('/zalo-accounts')"
      >
        <v-icon start size="18">mdi-plus</v-icon>
        Kết nối Zalo
      </v-btn>

      <!-- Status indicator -->
      <div
        class="d-none d-sm-flex align-center mr-2 px-3 py-1 neo-pill"
        style="background: var(--surface-card); font-size: 0.7rem; border-color: var(--border-color); height: 32px;"
      >
        <span
          class="status-dot"
          style="width: 8px; height: 8px; border-radius: 50%; background: #10B981; display: inline-block; margin-right: 6px; border: 1px solid var(--border-color);"
        ></span>
        <span class="font-weight-bold neo-subtitle" style="color: var(--text-main); font-size: 0.68rem; letter-spacing: 0.5px;">ONLINE</span>
      </div>

      <!-- Mechanical square control buttons -->
      <NotificationBell />

      <v-btn
        icon
        size="small"
        class="topbar-action-btn ml-1"
        title="Đổi giao diện Sáng/Tối"
        @click="toggleTheme"
      >
        <v-icon size="18">{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>

      <v-btn
        icon
        size="small"
        class="topbar-action-btn ml-1"
        title="Đăng xuất"
        @click="logout"
      >
        <v-icon size="18">mdi-logout</v-icon>
      </v-btn>
    </v-app-bar>

    <!-- Sidebar navigation -->
    <v-navigation-drawer
      v-model="drawer"
      :rail="rail && !mobile"
      :temporary="mobile"
      :permanent="!mobile"
      @click="rail = false"
    >
      <v-list density="compact" nav class="mt-2 px-2">
        <v-list-item
          v-for="item in menuItems"
          :key="item.path"
          :to="item.path"
          :prepend-icon="item.icon"
          :title="item.title"
          :value="item.path"
          rounded="lg"
          class="mb-1"
        />
      </v-list>

      <template #append>
        <NavUserProfile :rail="rail && !mobile" />
        <v-list density="compact" nav class="px-2 pb-2">
          <v-list-item
            :prepend-icon="rail ? 'mdi-chevron-right' : 'mdi-chevron-left'"
            :title="rail ? '' : 'Thu gọn'"
            @click.stop="rail = !rail"
            rounded="lg"
          />
        </v-list>
      </template>
    </v-navigation-drawer>

    <!-- Main content -->
    <v-main>
      <v-container fluid>
        <slot />
      </v-container>
    </v-main>
  </v-app>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useDisplay, useTheme } from 'vuetify';
import { useAuthStore } from '@/stores/auth';
import { useRouter } from 'vue-router';
import NotificationBell from '@/components/NotificationBell.vue';
import GlobalSearch from '@/components/GlobalSearch.vue';
import NavUserProfile from '@/components/navigation/NavUserProfile.vue';

const theme = useTheme();
const authStore = useAuthStore();
const router = useRouter();
const { mobile } = useDisplay();

const drawer = ref(true);
const rail = ref(false);
const isDark = ref(localStorage.getItem('theme') === 'dark');

onMounted(() => {
  theme.global.name.value = isDark.value ? 'dark' : 'light';
});

const menuItems = [
  { title: 'Dashboard', icon: 'mdi-view-dashboard-outline', path: '/' },
  { title: 'Tin nhắn', icon: 'mdi-message-text-outline', path: '/chat' },
  { title: 'Khách hàng', icon: 'mdi-account-group-outline', path: '/contacts' },
  { title: 'Tài khoản Zalo', icon: 'mdi-cellphone-link', path: '/zalo-accounts' },
  { title: 'Lịch hẹn', icon: 'mdi-calendar-clock-outline', path: '/appointments' },
  { title: 'Đơn hàng', icon: 'mdi-cart-outline', path: '/orders' },
  { title: 'Báo cáo', icon: 'mdi-chart-arc', path: '/reports' },
  { title: 'Báo cáo AI', icon: 'mdi-robot-outline', path: '/ai-reports' },
  { title: 'Nhân viên', icon: 'mdi-account-cog-outline', path: '/settings' },
  { title: 'API & Webhook', icon: 'mdi-api', path: '/api-settings' },
];

function toggleTheme() {
  isDark.value = !isDark.value;
  theme.global.name.value = isDark.value ? 'dark' : 'light';
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
}

function logout() {
  authStore.logout();
  router.push('/login');
}
</script>

<style scoped>
.app-top-bar {
  border-bottom: 1.5px solid var(--border-color) !important;
}

.brand-title {
  user-select: none;
}

.topbar-action-btn {
  width: 36px !important;
  height: 36px !important;
  border: 1.5px solid var(--border-color) !important;
  border-radius: 8px !important;
  background: var(--surface-card) !important;
}

.primary-cta-btn {
  box-shadow: none !important;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
