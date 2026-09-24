<template>
  <v-app>
    <component :is="layout" v-if="layout">
      <router-view />
    </component>
    <!-- Fullscreen Fallback Banner khi không có layout và gặp sự cố máy chủ -->
    <NetworkErrorBanner
      v-else-if="authStore.status === 'unavailable'"
      fullscreen
    />
    <!-- Minimal loader trong lúc router và session đang kiểm tra -->
    <div v-else class="app-bootstrap-loader d-flex align-center justify-center fill-height">
      <v-progress-circular indeterminate color="primary" size="48" />
    </div>

    <!-- Fixed-Top Banner khi người dùng đang có phiên làm việc nhưng mạng bị rớt -->
    <NetworkErrorBanner
      v-if="layout && authStore.status === 'unavailable'"
      fixed-top
    />
  </v-app>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { onSessionExpired } from '@/api/index';
import DefaultLayout from '@/layouts/DefaultLayout.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';
import NetworkErrorBanner from '@/components/common/NetworkErrorBanner.vue';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const layout = computed(() => {
  if (route.meta.layout === 'auth') return AuthLayout;
  // Fail-closed: Chỉ hiển thị DefaultLayout khi người dùng thực sự đã xác thực
  if (authStore.isAuthenticated) return DefaultLayout;
  return null;
});

onMounted(() => {
  const unsubscribe = onSessionExpired(() => {
    authStore.clearSession();
    if (route.meta.requiresAuth) {
      router.push({
        name: 'Login',
        query: { redirect: route.fullPath },
      });
    }
  });
  onUnmounted(unsubscribe);
});
</script>

<style scoped>
.app-bootstrap-loader {
  min-height: 100vh;
  width: 100%;
  background-color: var(--bg-main, #f8fafc);
}
</style>
