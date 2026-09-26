<script setup lang="ts">
defineProps<{
  account?: {
    displayName?: string | null;
    branchTag?: string | null;
  } | null;
  accountColor: string;
  isAccountOnline: boolean;
}>();
</script>

<template>
  <div
    v-if="account"
    class="safety-compose-bar px-3 py-1 d-flex align-center justify-space-between"
    :style="{
      borderLeft: `4px solid ${accountColor}`,
      borderTop: '1.5px solid var(--border-color)',
      backgroundColor: 'var(--bg-main, #f8f9fa)',
    }"
  >
    <div class="d-flex align-center text-caption font-weight-medium text-truncate mr-2">
      <span class="mr-1 text-grey-darken-1 font-mono" style="font-size: 0.7rem;">ĐANG TRẢ LỜI BẰNG:</span>
      <span class="font-weight-bold mr-2 text-truncate" :style="{ color: accountColor, fontSize: '0.78rem' }">
        {{ account.displayName || 'Zalo' }}
      </span>
      <span
        v-if="account.branchTag"
        class="neo-pill px-1 py-0 font-weight-bold"
        :style="{
          backgroundColor: accountColor,
          color: '#FFFFFF',
          border: '1px solid var(--border-color)',
          fontSize: '0.65rem !important',
        }"
      >
        {{ account.branchTag }}
      </span>
    </div>

    <div class="d-flex align-center text-caption text-grey-darken-1 flex-shrink-0" style="font-size: 0.72rem;">
      <span
        class="status-dot mr-1"
        :class="isAccountOnline ? 'status-online' : 'status-offline'"
      />
      <span>{{ isAccountOnline ? 'Online' : 'Mất kết nối' }}</span>
    </div>
  </div>
</template>

<style scoped>
.safety-compose-bar {
  transition: border-color 0.2s ease;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.status-online {
  background-color: #10B981;
  box-shadow: 0 0 4px #10B981;
}

.status-offline {
  background-color: #9CA3AF;
}
</style>
