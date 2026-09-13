<template>
  <v-card class="pa-6" elevation="0">
    <div class="text-center mb-6">
      <div
        class="mx-auto mb-3 d-flex align-center justify-center neo-icon-box"
        style="width: 56px; height: 56px; background: #0068FF; color: #FFFFFF; border: 1.5px solid var(--border-color); border-radius: 8px;"
      >
        <v-icon size="32" color="#FFFFFF">mdi-cog</v-icon>
      </div>
      <h1 class="neo-page-title mb-1" style="font-size: 1.5rem;">THIẾT LẬP <span class="neo-title-accent">HỆ THỐNG</span></h1>
      <p class="text-caption neo-subtitle" style="color: var(--text-muted);">TẠO TỔ CHỨC VÀ TÀI KHOẢN QUẢN TRỊ VIÊN</p>
    </div>
    <v-form @submit.prevent="handleSetup" ref="form">
      <v-text-field v-model="orgName" label="Tên tổ chức / phòng khám" prepend-inner-icon="mdi-domain" :rules="[v => !!v || 'Bắt buộc']" class="mb-2" />
      <v-text-field v-model="fullName" label="Họ tên quản trị viên" prepend-inner-icon="mdi-account" :rules="[v => !!v || 'Bắt buộc']" class="mb-2" />
      <v-text-field v-model="email" label="Email đăng nhập" type="email" prepend-inner-icon="mdi-email" :rules="[v => !!v || 'Bắt buộc']" class="mb-2" />
      <v-text-field v-model="password" label="Mật khẩu" type="password" prepend-inner-icon="mdi-lock" :rules="[v => v.length >= 6 || 'Tối thiểu 6 ký tự']" class="mb-4" />
      <v-btn type="submit" color="primary" block size="large" :loading="loading" rounded="lg" class="font-weight-bold" style="border: 1.5px solid var(--border-color);">TẠO TÀI KHOẢN</v-btn>
    </v-form>
    <v-alert v-if="error" type="error" class="mt-4" density="compact" closable>{{ error }}</v-alert>
    <v-alert v-if="success" type="success" class="mt-4" density="compact">Tạo thành công! Đang chuyển hướng...</v-alert>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const orgName = ref('');
const fullName = ref('');
const email = ref('');
const password = ref('');
const loading = ref(false);
const error = ref('');
const success = ref(false);
const router = useRouter();
const authStore = useAuthStore();

async function handleSetup() {
  loading.value = true;
  error.value = '';
  try {
    await authStore.setup({ orgName: orgName.value, fullName: fullName.value, email: email.value, password: password.value });
    success.value = true;
    setTimeout(() => router.push('/'), 1000);
  } catch (err: any) {
    error.value = err.response?.data?.error || 'Thiết lập thất bại';
  } finally {
    loading.value = false;
  }
}
</script>
