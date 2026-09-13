<template>
  <div v-if="authStore.user" class="nav-user-profile-wrapper">
    <!-- Rail mode collapsed: Centered Circular Avatar with Tooltip -->
    <div v-if="rail" class="py-2 text-center">
      <v-tooltip :text="`${authStore.user.fullName} (${roleLabel})`" location="end">
        <template #activator="{ props }">
          <v-avatar
            v-bind="props"
            size="38"
            color="primary"
            class="text-white font-weight-bold mx-auto cursor-pointer"
            rounded="circle"
          >
            {{ initials }}
          </v-avatar>
        </template>
      </v-tooltip>
    </div>

    <!-- Expanded mode: Floating profile card matching CQA spec -->
    <div v-else class="nav-profile-card">
      <!-- Top environment & version badge -->
      <div class="d-flex align-center justify-space-between mb-2">
        <span class="neo-pill env-badge px-2 py-0">
          {{ envBadge }}
        </span>
        <span class="text-caption text-muted font-weight-bold" style="font-size: 0.65rem;">
          {{ authStore.user.orgName || 'ZaloCRM' }}
        </span>
      </div>

      <!-- User row: circular avatar + name & email -->
      <div class="d-flex align-center mb-2">
        <v-avatar
          size="38"
          color="primary"
          class="text-white font-weight-bold mr-2 flex-shrink-0"
          rounded="circle"
        >
          {{ initials }}
        </v-avatar>
        <div class="text-truncate flex-grow-1" style="min-width: 0;">
          <div class="text-body-2 font-weight-bold text-truncate" style="line-height: 1.2;">
            {{ authStore.user.fullName }}
          </div>
          <div class="text-caption text-muted text-truncate" style="font-size: 0.72rem;">
            {{ authStore.user.email }}
          </div>
        </div>
      </div>

      <!-- Role pill chip -->
      <div class="d-flex align-center justify-space-between">
        <span class="neo-pill role-pill px-2 py-0" :class="roleClass">
          {{ roleLabel }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{
  rail?: boolean;
}>();

const authStore = useAuthStore();

const envBadge = computed(() => {
  return import.meta.env.MODE === 'production' ? '• v1.0.0 PROD' : '• v1.0.0 DEV';
});

const initials = computed(() => {
  const name = authStore.user?.fullName?.trim() || 'U';
  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
});

const roleLabel = computed(() => {
  const role = authStore.user?.role;
  if (role === 'owner') return 'CHỦ SỞ HỮU';
  if (role === 'admin') return 'QUẢN TRỊ VIÊN';
  return 'NHÂN VIÊN';
});

const roleClass = computed(() => {
  const role = authStore.user?.role;
  if (role === 'owner') return 'role-owner';
  if (role === 'admin') return 'role-admin';
  return 'role-member';
});
</script>

<style scoped>
.nav-user-profile-wrapper {
  padding: 8px 12px;
}

.nav-profile-card {
  background: var(--surface-card);
  border: 1.5px solid var(--border-color);
  border-radius: 12px;
  padding: 10px 12px;
}

.env-badge {
  background: var(--surface-variant);
  color: var(--text-muted);
  border: 1px solid var(--border-color) !important;
  font-size: 0.65rem !important;
  letter-spacing: 0.04em;
}

.role-pill {
  font-size: 0.65rem !important;
  letter-spacing: 0.03em;
}

.role-owner {
  background: var(--pastel-yellow-bg);
  color: var(--pastel-yellow-fg);
  border-color: var(--border-color) !important;
}

.role-admin {
  background: var(--pastel-blue-bg);
  color: var(--pastel-blue-fg);
  border-color: var(--border-color) !important;
}

.role-member {
  background: var(--pastel-green-bg);
  color: var(--pastel-green-fg);
  border-color: var(--border-color) !important;
}

.cursor-pointer {
  cursor: pointer;
}
</style>
