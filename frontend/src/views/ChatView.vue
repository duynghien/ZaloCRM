<template>
  <div class="chat-container d-flex" style="height: calc(100vh - 56px);">
    <!-- Conversation list — resizable (hidden on mobile if conversation is selected) -->
    <div
      v-if="!mobile || !selectedConvId"
      class="chat-panel-left"
      :style="{ width: mobile ? '100%' : leftWidth + 'px' }"
    >
      <ConversationList
        :conversations="conversations"
        :selected-id="selectedConvId"
        :loading="loadingConvs"
        v-model:search="searchQuery"
        @select="selectConversation"
        @filter-account="onFilterAccount"
      />
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
      @back="selectedConvId = null"
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
        @close="showContactPanel = false"
        @saved="fetchConversations()"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useDisplay } from 'vuetify';
import ConversationList from '@/components/chat/ConversationList.vue';
import MessageThread from '@/components/chat/MessageThread.vue';
import ChatContactPanel from '@/components/chat/ChatContactPanel.vue';
import { useChat } from '@/composables/use-chat';

const { mobile } = useDisplay();

const {
  conversations, selectedConvId, selectedConv, messages,
  loadingConvs, loadingMsgs, sendingMsg, searchQuery, accountFilter,
  fetchConversations, selectConversation, sendMessage,
  initSocket, destroySocket,
} = useChat();

function onFilterAccount(id: string | null) {
  accountFilter.value = id;
  fetchConversations();
}

const showContactPanel = ref(false);

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

onMounted(() => { fetchConversations(); initSocket(); });
onUnmounted(() => { destroySocket(); });

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
  min-width: 200px;
  max-width: 500px;
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
