<template>
  <v-card class="pa-8" elevation="0">
    <div class="text-center mb-8">
      <img
        src="/zalocrm.png"
        alt="ZaloCRM"
        class="brand-logo-login mb-4 mx-auto d-block"
        style="height: 56px; width: auto; object-fit: contain;"
      />
      <p class="text-caption neo-subtitle" style="color: var(--text-muted);">
        HỆ THỐNG QUẢN LÝ ĐA TÀI KHOẢN ZALO
      </p>
    </div>

    <v-form @submit.prevent="handleLogin">
      <v-text-field
        v-model="email"
        label="Email"
        type="email"
        prepend-inner-icon="mailbox.svg"
        required
        class="mb-3"
      />
      <v-text-field
        v-model="password"
        label="Mật khẩu"
        type="password"
        prepend-inner-icon="fingerprint.svg"
        required
        class="mb-5"
      />
      <v-btn type="submit" color="primary" block size="large" :loading="loading" rounded="lg" class="font-weight-bold" style="border: 1.5px solid var(--border-color);">
        <v-icon start>arrow-narrow-circle-broken-down.svg</v-icon>
        ĐĂNG NHẬP
      </v-btn>
    </v-form>

    <v-alert v-if="error" type="error" class="mt-4" density="compact" closable variant="tonal">
      {{ error }}
    </v-alert>
  </v-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const email = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

onMounted(async () => {
  // Check if first-time setup needed in case guard did not catch it
  try {
    const needs = await authStore.checkSetup();
    if (needs) router.replace('/setup');
  } catch {}
});

function getSafeRedirect(target: unknown): string {
  if (
    typeof target !== 'string' ||
    !target.startsWith('/') ||
    target.startsWith('//') ||
    target.includes('\\')
  ) {
    return '/';
  }
  try {
    const resolved = router.resolve(target);
    // Don't allow redirecting to non-existent route, login itself, not found, or setup
    if (!resolved.matched.length || resolved.name === 'Login' || resolved.name === 'NotFound' || resolved.name === 'Setup') {
      return '/';
    }
    return target;
  } catch {
    return '/';
  }
}

async function handleLogin() {
  loading.value = true;
  error.value = '';
  try {
    await authStore.login(email.value, password.value);
    const safeTarget = getSafeRedirect(route.query.redirect);
    router.push(safeTarget);
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Đăng nhập thất bại';
  } finally {
    loading.value = false;
  }
}
</script>
