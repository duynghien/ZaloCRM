<template>
  <div class="chat-container d-flex" style="height: calc(100vh - 56px);">
    <!-- Left panel (Account rail + Conversation list) — resizable (hidden on mobile if conversation is selected) -->
    <div
      v-if="!mobile || !selectedConvId"
      class="chat-panel-left d-flex"
      :class="{ 'flex-column': mobile, 'flex-row': !mobile }"
      :style="{ width: mobile ? '100%' : (leftWidth + 64) + 'px' }"
    >
      <!-- Account Rail (Vertical on desktop, horizontal strip on mobile) -->
      <AccountRail
        :accounts="accounts"
        :selected-account-id="accountFilter"
        :unread-map="accountUnreadMap"
        :mobile="mobile"
        @select="onSelectAccount"
      />

      <!-- Conversation List -->
      <div class="flex-grow-1 overflow-hidden" style="height: 100%;">
        <ConversationList
          :conversations="conversations"
          :selected-id="selectedConvId"
          :selected-account-id="accountFilter"
          :accounts="accounts"
          :loading="loadingConvs"
          v-model:search="searchQuery"
          @select="selectConversation"
          @clear-account-filter="onSelectAccount(null)"
        />
      </div>

      <!-- Resize handle (only on desktop) -->
      <div v-if="!mobile" class="resize-handle" @mousedown="startResize('left', $event)" />
    </div>

    <!-- Message thread — flexible center (hidden on mobile if no conversation selected) -->
    <MessageThread
      v-if="!mobile || selectedConvId"
      :conversation="selectedConv"
      :messages="messages"
      :loading="loadingMsgs"
      :sending="sendingMsg"
      :show-contact-panel="showContactPanel"
      @send="sendMessage"
      @toggle-contact-panel="showContactPanel = !showContactPanel"
      @open-order-draft="onOpenOrderDraft"
      @open-appointment-draft="onOpenAppointmentDraft"
      @back="onMobileBack"
      style="flex: 1; min-width: 300px;"
    />

    <!-- Contact panel — resizable (desktop only or modal/panel) -->
    <div
      v-if="showContactPanel && selectedConv?.contact"
      class="chat-panel-right"
      :style="{ width: mobile ? '100%' : rightWidth + 'px' }"
    >
      <div v-if="!mobile" class="resize-handle resize-handle-left" @mousedown="startResize('right', $event)" />
      <ChatContactPanel
        :contact-id="selectedConv.contact.id"
        :contact="selectedConv.contact"
        :pending-order-draft="pendingOrderDraft"
        :pending-appointment-draft="pendingAppointmentDraft"
        @close="showContactPanel = false"
        @saved="fetchConversations()"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useDisplay } from 'vuetify';
import AccountRail from '@/components/chat/AccountRail.vue';
import ConversationList from '@/components/chat/ConversationList.vue';
import MessageThread from '@/components/chat/MessageThread.vue';
import ChatContactPanel from '@/components/chat/ChatContactPanel.vue';
import { useChat } from '@/composables/use-chat';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';

const route = useRoute();
const router = useRouter();
const { mobile } = useDisplay();

const { accounts, fetchAccounts } = useZaloAccounts();

const {
  conversations, selectedConvId, selectedConv, messages,
  loadingConvs, loadingMsgs, sendingMsg, searchQuery, accountFilter,
  accountUnreadMap, fetchAccountUnreads,
  fetchConversations, selectConversation, sendMessage,
  initSocket, destroySocket,
} = useChat();

const showContactPanel = ref(false);
const pendingOrderDraft = ref<{ totalAmount?: number; notes?: string } | null>(null);
const pendingAppointmentDraft = ref<{ date?: string; time?: string; notes?: string } | null>(null);

function onOpenOrderDraft(draft: any) {
  pendingOrderDraft.value = draft;
  showContactPanel.value = true;
}

function onOpenAppointmentDraft(draft: any) {
  pendingAppointmentDraft.value = draft;
  showContactPanel.value = true;
}

function onSelectAccount(id: string | null) {
  // If a conversation is currently open and it doesn't belong to the newly selected account, close it immediately
  if (selectedConv.value && id !== null && selectedConv.value.zaloAccount?.id !== id) {
    selectedConvId.value = null;
  }

  accountFilter.value = id;

  if (id) {
    localStorage.setItem('chat-account-filter', id);
    router.replace({ query: { ...route.query, account: id } });
  } else {
    localStorage.removeItem('chat-account-filter');
    const newQuery = { ...route.query };
    delete newQuery.account;
    router.replace({ query: newQuery });
  }

  fetchConversations();
}

function onMobileBack() {
  // Reset selected conversation but preserve active account filter
  selectedConvId.value = null;
}

// Resizable panel widths (restored from localStorage)
const leftWidth = ref(parseInt(localStorage.getItem('chat-left-width') || '320'));
const rightWidth = ref(parseInt(localStorage.getItem('chat-right-width') || '320'));

let resizing: 'left' | 'right' | null = null;
let startX = 0;
let startWidth = 0;

function startResize(panel: 'left' | 'right', e: MouseEvent) {
  resizing = panel;
  startX = e.clientX;
  startWidth = panel === 'left' ? leftWidth.value : rightWidth.value;
  document.addEventListener('mousemove', onResize);
  document.addEventListener('mouseup', stopResize);
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
}

function onResize(e: MouseEvent) {
  if (!resizing) return;
  const diff = e.clientX - startX;
  if (resizing === 'left') {
    leftWidth.value = Math.max(200, Math.min(500, startWidth + diff));
  } else {
    rightWidth.value = Math.max(250, Math.min(500, startWidth - diff));
  }
}

function stopResize() {
  if (resizing) {
    localStorage.setItem('chat-left-width', String(leftWidth.value));
    localStorage.setItem('chat-right-width', String(rightWidth.value));
  }
  resizing = null;
  document.removeEventListener('mousemove', onResize);
  document.removeEventListener('mouseup', stopResize);
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
}

onMounted(async () => {
  await Promise.all([
    fetchAccounts(),
    fetchAccountUnreads(),
  ]);

  // Restore filter from URL query param or localStorage
  const queryAccount = typeof route.query.account === 'string' ? route.query.account : null;
  const savedAccount = localStorage.getItem('chat-account-filter');

  const initialAccount = queryAccount || savedAccount;
  if (initialAccount && accounts.value.some(a => a.id === initialAccount)) {
    accountFilter.value = initialAccount;
    if (!queryAccount) {
      router.replace({ query: { ...route.query, account: initialAccount } });
    }
  } else if (queryAccount) {
    const newQuery = { ...route.query };
    delete newQuery.account;
    router.replace({ query: newQuery });
    localStorage.removeItem('chat-account-filter');
    accountFilter.value = null;
  }

  fetchConversations();
  initSocket();
});

onUnmounted(() => {
  destroySocket();
});

// Watch URL query for browser navigation (Back/Forward buttons)
watch(
  () => route.query.account,
  (newAccId) => {
    const targetId = typeof newAccId === 'string' ? newAccId : null;
    if (targetId !== accountFilter.value) {
      if (selectedConv.value && targetId !== null && selectedConv.value.zaloAccount?.id !== targetId) {
        selectedConvId.value = null;
      }
      accountFilter.value = targetId;
      if (targetId) {
        localStorage.setItem('chat-account-filter', targetId);
      } else {
        localStorage.removeItem('chat-account-filter');
      }
      fetchConversations();
    }
  },
);

let searchTimeout: ReturnType<typeof setTimeout>;
watch(searchQuery, () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => fetchConversations(), 300);
});
</script>

<style scoped>
.chat-container {
  margin: -16px;
  background-color: var(--bg-main);
}

.chat-panel-left {
  position: relative;
  flex-shrink: 0;
  min-width: 264px;
  max-width: 564px;
}

.chat-panel-right {
  position: relative;
  flex-shrink: 0;
  min-width: 250px;
  max-width: 500px;
}

/* Resize handle — thin vertical line on the edge */
.resize-handle {
  position: absolute;
  top: 0;
  right: -2px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s ease-in-out;
}

.resize-handle:hover,
.resize-handle:active {
  background: var(--primary-brand);
}

.resize-handle-left {
  right: auto;
  left: -2px;
}
</style>
