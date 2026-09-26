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
    <div class="flex-grow-1 text-truncate mr-2">
      <div class="d-flex align-center flex-wrap gap-1">
        <span class="font-weight-bold text-truncate text-body-2">
          {{ conversation.threadType === 'group' ? (conversation.contact?.fullName || 'Nhóm') : (conversation.contact?.fullName || 'Khách hàng') }}
        </span>
        <v-chip
          v-if="conversation.zaloAccount?.branchTag"
          size="x-small"
          class="font-weight-bold neo-pill"
          :style="{
            backgroundColor: accountColor,
            color: '#FFFFFF',
            border: '1px solid var(--border-color)',
            fontSize: '0.65rem !important'
          }"
        >
          {{ conversation.zaloAccount.branchTag }}
        </v-chip>

        <!-- Active Tags Display in Header -->
        <span
          v-for="assignment in (conversation.tags || []).slice(0, 3)"
          :key="assignment.tagId"
          class="neo-pill text-caption font-weight-bold d-inline-flex align-center"
          :style="{
            backgroundColor: assignment.tag?.color || '#0068FF',
            color: getContrastTextColor(assignment.tag?.color),
            border: '1.5px solid var(--border-color)',
            fontSize: '0.65rem !important',
            lineHeight: '1.3',
            padding: '2px 4px !important'
          }"
          :title="assignment.tag?.name"
        >
          <span class="header-tag-bullet mr-1" :style="{ backgroundColor: getContrastTextColor(assignment.tag?.color) }" />
          {{ assignment.tag?.name }}
        </span>
        <span
          v-if="(conversation.tags?.length || 0) > 3"
          class="neo-pill text-caption font-weight-bold bg-surface-variant"
          :style="{
            border: '1.5px solid var(--border-color)',
            fontSize: '0.62rem !important',
            lineHeight: '1.3',
            padding: '2px 4px !important'
          }"
          :title="(conversation.tags || []).slice(3).map(t => t.tag?.name).join(', ')"
        >
          +{{ (conversation.tags?.length || 0) - 3 }}
        </span>
      </div>

      <div class="text-caption text-grey d-flex align-center mt-0.5">
        <span class="mr-1">Tiếp nhận qua:</span>
        <span class="font-weight-medium" :style="{ color: accountColor }">
          {{ conversation.zaloAccount?.displayName || 'Zalo' }}
        </span>
      </div>
    </div>

    <!-- Actions: Tag Assign Menu + Contact Panel Toggle -->
    <div class="d-flex align-center gap-1 flex-shrink-0">
      <ConversationTagAssignMenu :conversation="conversation" />

      <v-btn
        :icon="showContactPanel ? 'mdi-account-details' : 'water.svg'"
        size="small"
        variant="text"
        class="topbar-action-btn"
        :color="showContactPanel ? 'primary' : undefined"
        :title="showContactPanel ? 'Đóng thông tin liên hệ' : 'Xem thông tin liên hệ'"
        @click="$emit('toggle-contact-panel')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Conversation } from '@/composables/use-chat';
import { getContrastTextColor } from '@/utils/account-colors';
import ConversationTagAssignMenu from './ConversationTagAssignMenu.vue';

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

<style scoped>
.header-tag-bullet {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  display: inline-block;
}
</style>
