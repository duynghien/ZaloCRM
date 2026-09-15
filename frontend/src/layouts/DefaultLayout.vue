<template>
  <v-app>
    <!-- Top bar — CQA Neo-Brutalism bar -->
    <v-app-bar :height="56" flat class="app-top-bar px-3">
      <!-- Brand Logo: ZaloCRM PNG -->
      <div class="d-flex align-center cursor-pointer mr-3" @click="router.push('/')">
        <img
          src="/zalocrm.png"
          alt="ZaloCRM"
          class="brand-logo"
          style="height: 36px; width: auto; object-fit: contain;"
        />
      </div>

      <v-spacer />

      <!-- Right control cluster with uniform gap: 8px and height: 36px -->
      <div class="d-flex align-center" style="gap: 8px;">
        <!-- Global search icon button (expands when clicked) -->
        <GlobalSearch />

        <!-- Primary Action: + Kết nối Zalo (Admin/Owner guarded) -->
        <v-btn
          v-if="authStore.isAdmin"
          color="primary"
          size="small"
          class="font-weight-bold text-white px-3 primary-cta-btn"
          rounded="lg"
          style="border: 1.5px solid var(--border-color); font-family: 'Space Grotesk', sans-serif; height: 36px;"
          @click="router.push('/zalo-accounts')"
        >
          <v-icon start size="18">plus-large.svg</v-icon>
          Kết nối Zalo
        </v-btn>

        <!-- Notification Bell (36x36 mechanical button) -->
        <NotificationBell />

        <!-- Theme toggle (36x36 mechanical button) -->
        <v-btn
          icon
          size="small"
          class="topbar-action-btn"
          title="Đổi giao diện Sáng/Tối"
          @click="toggleTheme"
        >
          <v-icon size="18">{{ isDark ? 'sun.svg' : 'moon.svg' }}</v-icon>
        </v-btn>
      </div>
    </v-app-bar>

    <!-- Sidebar navigation (fixed size, no collapse buttons) -->
    <v-navigation-drawer
      v-model="drawer"
      :permanent="!mobile"
      :temporary="mobile"
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
          class="sidebar-nav-item mb-1"
        />
      </v-list>

      <template #append>
        <NavUserProfile />
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
import { navMenuItems as menuItems } from '@/components/navigation/nav-menu-items';

const theme = useTheme();
const authStore = useAuthStore();
const router = useRouter();
const { mobile } = useDisplay();

const drawer = ref(true);
const isDark = ref(localStorage.getItem('theme') === 'dark');

onMounted(() => {
  theme.global.name.value = isDark.value ? 'dark' : 'light';
});

function toggleTheme() {
  isDark.value = !isDark.value;
  theme.global.name.value = isDark.value ? 'dark' : 'light';
  localStorage.setItem('theme', isDark.value ? 'dark' : 'light');
}
</script>

<style scoped>
.app-top-bar {
  border-bottom: 1.5px solid var(--border-color) !important;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
