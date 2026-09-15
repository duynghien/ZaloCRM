<template>
  <div class="global-search-container">
    <!-- Collapsed icon button (36x36 mechanical) -->
    <v-btn
      v-if="!isExpanded"
      icon
      size="small"
      class="topbar-action-btn"
      title="Tìm kiếm"
      @click="expandSearch"
    >
      <v-icon size="18">search-alt-1.svg</v-icon>
    </v-btn>

    <!-- Expanded search bar -->
    <div
      v-else
      class="global-search-expanded"
      v-click-outside="{ handler: onClickOutside, closeConditional: () => !showResults }"
    >
      <v-text-field
        ref="inputRef"
        v-model="query"
        placeholder="Tìm kiếm..."
        prepend-inner-icon="search-alt-1.svg"
        append-inner-icon="mdi-close"
        variant="outlined"
        density="compact"
        hide-details
        rounded="lg"
        class="global-search-input"
        @click:append-inner="collapseSearch"
        @keydown.esc="collapseSearch"
        @update:model-value="debouncedSearch"
      />
      <v-menu
        v-model="showResults"
        activator="parent"
        :close-on-content-click="true"
        max-width="380"
        offset-y
      >
        <v-card v-if="hasResults" class="search-results-card" style="max-height: 400px; overflow-y: auto;">
          <!-- Contacts -->
          <template v-if="results.contacts.length">
            <v-list-subheader class="font-weight-bold neo-subtitle">Khách hàng</v-list-subheader>
            <v-list-item
              v-for="c in results.contacts"
              :key="c.id"
              @click="goTo('/contacts', c.id)"
              density="compact"
            >
              <template #prepend><v-icon size="18" color="primary">user-alt.svg</v-icon></template>
              <v-list-item-title>{{ c.fullName || c.phone }}</v-list-item-title>
              <v-list-item-subtitle v-if="c.diseaseName">{{ c.diseaseName }}</v-list-item-subtitle>
            </v-list-item>
          </template>
          <!-- Messages -->
          <template v-if="results.messages.length">
            <v-divider />
            <v-list-subheader class="font-weight-bold neo-subtitle">Tin nhắn</v-list-subheader>
            <v-list-item
              v-for="m in results.messages"
              :key="m.id"
              @click="goTo('/chat', m.conversation?.id)"
              density="compact"
            >
              <template #prepend><v-icon size="18" color="info">mdi-chat</v-icon></template>
              <v-list-item-title class="text-truncate" style="max-width: 300px;">
                {{ truncate(m.content, 60) }}
              </v-list-item-title>
              <v-list-item-subtitle>{{ m.senderName }} · {{ formatDate(m.sentAt) }}</v-list-item-subtitle>
            </v-list-item>
          </template>
          <!-- Appointments -->
          <template v-if="results.appointments.length">
            <v-divider />
            <v-list-subheader class="font-weight-bold neo-subtitle">Lịch hẹn</v-list-subheader>
            <v-list-item
              v-for="a in results.appointments"
              :key="a.id"
              @click="goTo('/appointments')"
              density="compact"
            >
              <template #prepend><v-icon size="18" color="warning">mdi-calendar</v-icon></template>
              <v-list-item-title>{{ a.contact?.fullName }} · {{ formatDate(a.appointmentDate) }}</v-list-item-title>
              <v-list-item-subtitle>{{ a.notes }}</v-list-item-subtitle>
            </v-list-item>
          </template>
        </v-card>
        <v-card
          v-else-if="query && !loading"
          class="pa-4 text-center text-caption text-grey search-results-card"
        >
          Không tìm thấy kết quả
        </v-card>
      </v-menu>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';

interface ContactResult { id: string; fullName: string | null; phone: string | null; diseaseCode: string | null; diseaseName: string | null; }
interface MessageResult { id: string; content: string | null; senderName: string | null; sentAt: string; conversation?: { id: string; contact?: { fullName: string | null } } | null; }
interface AppointmentResult { id: string; appointmentDate: string; appointmentTime: string | null; notes: string | null; contact?: { fullName: string | null } | null; }
interface SearchResults { contacts: ContactResult[]; messages: MessageResult[]; appointments: AppointmentResult[]; }

const isExpanded = ref(false);
const inputRef = ref<{ focus: () => void } | null>(null);
const query = ref('');
const loading = ref(false);
const showResults = ref(false);
const results = ref<SearchResults>({ contacts: [], messages: [], appointments: [] });
const router = useRouter();

const hasResults = computed(
  () => results.value.contacts.length + results.value.messages.length + results.value.appointments.length > 0
);

let timeout: ReturnType<typeof setTimeout>;

function expandSearch() {
  isExpanded.value = true;
  nextTick(() => {
    inputRef.value?.focus();
  });
}

function collapseSearch() {
  isExpanded.value = false;
  showResults.value = false;
  query.value = '';
}

function onClickOutside() {
  if (!showResults.value && !query.value) {
    collapseSearch();
  }
}

function debouncedSearch(val: string | null) {
  clearTimeout(timeout);
  if (!val || val.length < 2) {
    showResults.value = false;
    return;
  }
  timeout = setTimeout(async () => {
    loading.value = true;
    try {
      const res = await api.get('/search', { params: { q: val } });
      results.value = res.data;
      showResults.value = true;
    } catch {
      // silently ignore search errors
    } finally {
      loading.value = false;
    }
  }, 300);
}

function goTo(path: string, _id?: string) {
  collapseSearch();
  router.push(path);
}

function truncate(s: string | null, len: number): string {
  return s && s.length > len ? s.slice(0, len) + '...' : s || '';
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
}
</script>

<style scoped>
.global-search-container {
  display: inline-flex;
  align-items: center;
}

.global-search-expanded {
  width: 260px;
  animation: searchExpand 0.2s ease-out;
}

@keyframes searchExpand {
  from {
    width: 36px;
    opacity: 0.5;
  }
  to {
    width: 260px;
    opacity: 1;
  }
}

.global-search-input :deep(.v-field) {
  height: 36px !important;
  min-height: 36px !important;
  background: var(--surface-card) !important;
  border-radius: var(--radius-input, 8px) !important;
  font-size: 0.85rem !important;
}

.global-search-input :deep(.v-field__input) {
  min-height: 36px !important;
  height: 36px !important;
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  font-size: 0.85rem !important;
}

.global-search-input :deep(.v-field__prepend-inner),
.global-search-input :deep(.v-field__append-inner) {
  padding-top: 0 !important;
  padding-bottom: 0 !important;
  align-items: center !important;
}

.search-results-card {
  border: 1.5px solid var(--border-color) !important;
  border-radius: 12px !important;
  background: var(--surface-card) !important;
}
</style>
