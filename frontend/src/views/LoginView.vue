<template>
  <v-card class="pa-8" elevation="0">
    <div class="text-center mb-8">
      <div
        class="mx-auto mb-4 d-flex align-center justify-center font-weight-black text-h4"
        style="width: 64px; height: 64px; background: #0068FF; border: 1.5px solid var(--border-color); border-radius: 4px; color: #FFFFFF; font-family: 'Space Grotesk', sans-serif;"
      >
        Z
      </div>
      <h1 class="text-h4 font-weight-black" style="font-family: 'Space Grotesk', sans-serif;">
        Zalo<span class="px-1 ml-1" style="background: #0068FF; color: #FFFFFF; border: 1.5px solid var(--border-color); border-radius: 4px; font-size: 1.25rem;">CRM</span>
      </h1>
      <p class="text-caption mt-2 neo-subtitle" style="color: var(--text-muted);">
        ZaloCRM • Hệ Thống Quản Lý Đa Tài Khoản Zalo
      </p>
    </div>

    <v-form @submit.prevent="handleLogin">
      <v-text-field
        v-model="email"
        label="Email"
        type="email"
        prepend-inner-icon="mdi-email-outline"
        required
        class="mb-3"
      />
      <v-text-field
        v-model="password"
        label="Mật khẩu"
        type="password"
        prepend-inner-icon="mdi-lock-outline"
        required
        class="mb-5"
      />
      <v-btn type="submit" color="primary" block size="large" :loading="loading" rounded="sm">
        <v-icon start>mdi-login</v-icon>
        Đăng nhập
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
