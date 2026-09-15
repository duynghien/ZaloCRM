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
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const email = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');
const router = useRouter();
const authStore = useAuthStore();

onMounted(async () => {
  // If already authenticated, skip login page
  if (authStore.isAuthenticated) {
    router.replace('/');
    return;
  }

  try {
    await authStore.init();
    if (authStore.isAuthenticated) {
      router.replace('/');
      return;
    }
  } catch {}

  // Check if first-time setup needed
  try {
    const needs = await authStore.checkSetup();
    if (needs) router.replace('/setup');
  } catch {}
});

async function handleLogin() {
  loading.value = true;
  error.value = '';
  try {
    await authStore.login(email.value, password.value);
    router.push('/');
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Đăng nhập thất bại';
  } finally {
    loading.value = false;
  }
}
</script>
