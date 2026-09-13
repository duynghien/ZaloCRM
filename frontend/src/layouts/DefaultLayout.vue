<template>
  <v-app>
    <!-- Top bar — Neo-Brutalism bar -->
    <v-app-bar density="comfortable" flat>
      <v-app-bar-nav-icon @click="drawer = !drawer" />

      <!-- Neo-Brutalism Logo + Title -->
      <div class="d-flex align-center" style="gap: 10px;">
        <div
          class="d-flex align-center justify-center font-weight-bold"
          style="width: 32px; height: 32px; background: #0068FF; border: 1.5px solid var(--border-color); border-radius: 4px; color: #FFFFFF; font-family: 'Space Grotesk', sans-serif;"
        >
          Z
        </div>
        <v-app-bar-title>
          <span class="font-weight-black" style="font-family: 'Space Grotesk', sans-serif; letter-spacing: -0.5px;">Zalo</span><span class="font-weight-black px-1 ml-1" style="background: #0068FF; color: #FFFFFF; border: 1.5px solid var(--border-color); border-radius: 4px; font-family: 'Space Grotesk', sans-serif; font-size: 0.85rem;">CRM</span>
        </v-app-bar-title>
      </div>

      <!-- Global search -->
      <GlobalSearch class="mx-2" />

      <v-spacer />

      <!-- Status indicator -->
      <div
        class="d-flex align-center mr-3 px-2 py-1"
        style="background: var(--surface-variant); border: 1.5px solid var(--border-color); border-radius: 4px;"
      >
        <span
          class="status-dot"
          style="width: 8px; height: 8px; border-radius: 2px; background: #10B981; display: inline-block; margin-right: 6px;"
        ></span>
        <span class="text-caption font-weight-bold neo-subtitle" style="color: var(--text-main); font-size: 0.7rem; letter-spacing: 0.5px;">ONLINE</span>
      </div>

      <div
        v-if="authStore.user"
        class="d-none d-sm-flex align-center mr-3 px-2 py-1 text-body-2 font-weight-bold"
        style="border: 1.5px solid var(--border-color); border-radius: 4px; background: var(--surface-card);"
      >
        {{ authStore.user.fullName }}
      </div>
      <NotificationBell />
      <v-btn icon variant="text" @click="toggleTheme">
        <v-icon>{{ isDark ? 'mdi-weather-sunny' : 'mdi-weather-night' }}</v-icon>
      </v-btn>
      <v-btn icon variant="text" @click="logout">
        <v-icon>mdi-logout</v-icon>
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
      <v-list density="compact" nav class="mt-2">
        <v-list-item
          v-for="item in menuItems"
          :key="item.path"
          :to="item.path"
          :prepend-icon="item.icon"
          :title="item.title"
          :value="item.path"
          rounded="sm"
          class="mb-1 mx-2"
        />
      </v-list>

      <template #append>
        <v-list density="compact" nav>
          <v-list-item
            prepend-icon="mdi-chevron-left"
            title="Thu gọn"
            @click.stop="rail = !rail"
            rounded="sm"
            class="mx-2"
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
