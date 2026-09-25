<template>
  <div class="message-thread-header pa-3 d-flex align-center" style="border-bottom: 1.5px solid var(--border-color);">
    <v-btn
      v-if="mobile"
      icon="mdi-arrow-left"
      size="small"
      variant="text"
      class="mr-2"
      @click="$emit('back')"
    />
    <v-avatar size="36" color="grey-lighten-2" class="mr-3" rounded="circle">
      <v-icon v-if="conversation.threadType === 'group'" icon="mdi-account-group" />
      <v-img v-else-if="conversation.contact?.avatarUrl" :src="conversation.contact.avatarUrl" />
      <v-icon v-else icon="user-alt.svg" />
    </v-avatar>
    <div class="flex-grow-1 text-truncate">
      <div class="d-flex align-center">
        <span class="font-weight-medium text-truncate">
          {{ conversation.threadType === 'group' ? (conversation.contact?.fullName || 'Nhóm') : (conversation.contact?.fullName || 'Khách hàng') }}
        </span>
        <v-chip
          v-if="conversation.threadType === 'group'"
          size="x-small"
          color="info"
          variant="tonal"
          rounded="pill"
          class="ml-1 neo-pill"
        >
          Nhóm
        </v-chip>
        <v-chip
          v-if="conversation.zaloAccount?.branchTag"
          size="x-small"
          class="ml-2 font-weight-bold neo-pill"
          :style="{
            backgroundColor: accountColor,
            color: '#FFFFFF',
            border: '1px solid var(--border-color)',
            fontSize: '0.65rem !important'
          }"
        >
          {{ conversation.zaloAccount.branchTag }}
        </v-chip>
      </div>
      <div class="text-caption text-grey d-flex align-center">
        <span class="mr-1">Tiếp nhận qua:</span>
        <span class="font-weight-medium" :style="{ color: accountColor }">
          {{ conversation.zaloAccount?.displayName || 'Zalo' }}
        </span>
      </div>
    </div>
    <v-btn
      :icon="showContactPanel ? 'mdi-account-details' : 'water.svg'"
      size="small"
      variant="text"
      :color="showContactPanel ? 'primary' : undefined"
      @click="$emit('toggle-contact-panel')"
    />
  </div>
</template>

<script setup lang="ts">
import type { Conversation } from '@/composables/use-chat';

defineProps<{
  conversation: Conversation;
  mobile: boolean;
  showContactPanel?: boolean;
  accountColor: string;
}>();

defineEmits<{
  (e: 'back'): void;
  (e: 'toggle-contact-panel'): void;
}>();
</script>
