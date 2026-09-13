<template>
  <v-card class="pa-8" elevation="0">
    <div class="text-center mb-8">
      <div
        class="mx-auto mb-4 d-flex align-center justify-center neo-icon-box"
        style="width: 56px; height: 56px; background: #0068FF; color: #FFFFFF; border: 1.5px solid var(--border-color); border-radius: 8px;"
      >
        <v-icon size="32" color="#FFFFFF">mdi-message-processing</v-icon>
      </div>
      <h1 class="neo-page-title mb-1" style="font-size: 1.75rem;">
        <span>ZALO</span><span class="neo-title-accent ml-1">CRM</span>
      </h1>
      <p class="text-caption neo-subtitle" style="color: var(--text-muted);">
        HỆ THỐNG QUẢN LÝ ĐA TÀI KHOẢN ZALO
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
      <v-btn type="submit" color="primary" block size="large" :loading="loading" rounded="lg" class="font-weight-bold" style="border: 1.5px solid var(--border-color);">
        <v-icon start>mdi-login</v-icon>
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
