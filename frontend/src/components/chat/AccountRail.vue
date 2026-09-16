<template>
  <aside
    class="account-rail"
    :class="{ 'account-rail-mobile': mobile, 'account-rail-desktop': !mobile }"
    :aria-label="'Thanh chọn tài khoản Zalo'"
  >
    <!-- Scrollable container for accounts -->
    <div class="rail-items-container">
      <!-- "ALL" / TẤT CẢ Button -->
      <div class="rail-item-wrapper">
        <v-tooltip
          :text="'Tất cả tài khoản' + (totalUnread > 0 ? ` (${totalUnread} tin chưa đọc)` : '')"
          :location="mobile ? 'bottom' : 'right'"
        >
          <template #activator="{ props: tooltipProps }">
            <button
              v-bind="tooltipProps"
              type="button"
              class="rail-btn"
              :class="{ 'rail-btn-active': selectedAccountId === null }"
              @click="$emit('select', null)"
              aria-label="Xem tất cả tài khoản"
            >
              <div class="rail-avatar-box rail-all-box">
                <span class="rail-all-text">ALL</span>
              </div>

              <!-- Total unread badge -->
              <span
                v-if="totalUnread > 0"
                class="rail-badge"
              >
                {{ totalUnread > 99 ? '99+' : totalUnread }}
              </span>
            </button>
          </template>
        </v-tooltip>
      </div>

      <div class="rail-divider" />

      <!-- List of Accounts -->
      <div
        v-for="acc in sortedAccounts"
        :key="acc.id"
        class="rail-item-wrapper"
      >
        <v-tooltip
          :location="mobile ? 'bottom' : 'right'"
        >
          <template #activator="{ props: tooltipProps }">
            <button
              v-bind="tooltipProps"
              type="button"
              class="rail-btn"
              :class="{ 'rail-btn-active': selectedAccountId === acc.id }"
              @click="$emit('select', acc.id)"
              :aria-label="acc.displayName || acc.phone || 'Tài khoản Zalo'"
            >
              <div
                class="rail-avatar-box"
                :style="{
                  backgroundColor: getAccountColor(acc),
                  color: getTextColor(acc),
                }"
              >
                <img
                  v-if="acc.avatarUrl"
                  :src="acc.avatarUrl"
                  :alt="acc.displayName || 'Avatar'"
                  class="rail-avatar-img"
                />
                <span v-else class="rail-monogram">
                  {{ getMonogram(acc) }}
                </span>

                <!-- Online / Offline Status Dot -->
                <span
                  class="status-indicator"
                  :class="isOnline(acc) ? 'status-online' : 'status-offline'"
                />
              </div>

              <!-- Individual Unread Badge -->
              <span
                v-if="getUnread(acc.id) > 0"
                class="rail-badge"
              >
                {{ getUnread(acc.id) > 99 ? '99+' : getUnread(acc.id) }}
              </span>
            </button>
          </template>

          <!-- Rich Tooltip Content -->
          <div class="rail-tooltip-content">
            <div class="font-weight-bold text-body-2">
              {{ acc.displayName || acc.phone || 'Zalo' }}
            </div>
            <div v-if="acc.branchTag" class="text-caption text-primary-light font-weight-medium">
              {{ acc.branchTag }}
            </div>
            <div class="text-caption" style="opacity: 0.85;">
              {{ isOnline(acc) ? 'Trực tuyến' : 'Ngoại tuyến' }}
              <span v-if="getUnread(acc.id) > 0" class="text-warning ml-1">
                • {{ getUnread(acc.id) }} chưa đọc
              </span>
            </div>
          </div>
        </v-tooltip>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ZaloAccount } from '@/composables/use-zalo-accounts';
import {
  getDeterministicAccountColor,
  getAccountMonogram,
  getContrastTextColor,
} from '@/utils/account-colors';

const props = defineProps<{
  accounts: ZaloAccount[];
  selectedAccountId: string | null;
  unreadMap?: Record<string, number>;
  mobile?: boolean;
}>();

defineEmits<{
  select: [accountId: string | null];
}>();

// Sorting rule: Group by branchTag (alphabetical), then by displayName (alphabetical)
const sortedAccounts = computed(() => {
  return [...props.accounts].sort((a, b) => {
    const branchA = (a.branchTag || '').trim().toLowerCase();
    const branchB = (b.branchTag || '').trim().toLowerCase();
    if (branchA !== branchB) {
      if (!branchA) return 1;
      if (!branchB) return -1;
      return branchA.localeCompare(branchB, 'vi');
    }
    const nameA = (a.displayName || a.phone || '').trim().toLowerCase();
    const nameB = (b.displayName || b.phone || '').trim().toLowerCase();
    return nameA.localeCompare(nameB, 'vi');
  });
});

function getUnread(accountId: string): number {
  return props.unreadMap?.[accountId] || 0;
}

const totalUnread = computed(() => {
  if (!props.unreadMap) return 0;
  return Object.values(props.unreadMap).reduce((sum, count) => sum + (count || 0), 0);
});

function getAccountColor(account: ZaloAccount): string {
  return getDeterministicAccountColor(account.id, account.colorTag);
}

function getTextColor(account: ZaloAccount): string {
  const bg = getAccountColor(account);
  return getContrastTextColor(bg);
}

function getMonogram(account: ZaloAccount): string {
  return getAccountMonogram(
    account.branchTag,
    account.displayName,
    account.phone,
    account.zaloUid,
  );
}

function isOnline(account: ZaloAccount): boolean {
  return account.liveStatus === 'connected' || account.status === 'connected' || account.status === 'active';
}
</script>

<style scoped>
.account-rail {
  user-select: none;
  background-color: var(--bg-main, #f8f9fa);
  flex-shrink: 0;
  z-index: 5;
}

/* Desktop: Vertical 64px rail */
.account-rail-desktop {
  width: 64px;
  height: 100%;
  border-right: 1.5px solid var(--border-color);
  display: flex;
  flex-direction: column;
  padding: 10px 0;
}

.account-rail-desktop .rail-items-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px;
}

/* Mobile: Horizontal scrollable strip */
.account-rail-mobile {
  width: 100%;
  height: 56px;
  border-bottom: 1.5px solid var(--border-color);
  display: flex;
  align-items: center;
  padding: 0 8px;
}

.account-rail-mobile .rail-items-container {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 4px 0;
}

/* Common button wrappers */
.rail-item-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.rail-btn {
  position: relative;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.rail-btn:hover {
  transform: scale(1.05);
}

.rail-btn-active {
  border-color: var(--text-main, #111827) !important;
}

.rail-btn-active .rail-avatar-box {
  box-shadow: 0 0 0 2px var(--bg-main, #ffffff), 0 0 0 4px var(--border-color, #111827);
}

/* Avatar Box */
.rail-avatar-box {
  position: relative;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  border: 1.5px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
  font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
  font-weight: 700;
  font-size: 0.85rem;
}

.rail-all-box {
  background-color: var(--surface-card, #ffffff);
  color: var(--text-main, #111827);
}

.rail-all-text {
  font-weight: 800;
  letter-spacing: 0.5px;
  font-size: 0.75rem;
}

.rail-avatar-img {
  width: 100%;
  height: 100%;
  border-radius: 6px;
  object-fit: cover;
}

.rail-monogram {
  line-height: 1;
}

/* Status Indicator Dot */
.status-indicator {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.5px solid var(--bg-main, #ffffff);
}

.status-online {
  background-color: #10B981;
}

.status-offline {
  background-color: #9CA3AF;
}

/* Unread Badge */
.rail-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background-color: #EF4444;
  color: #FFFFFF;
  border: 1.5px solid var(--border-color);
  border-radius: 10px;
  font-size: 0.65rem;
  font-weight: 800;
  padding: 0 5px;
  min-width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  box-shadow: 1px 1px 0px rgba(0, 0, 0, 0.2);
}

/* Divider */
.account-rail-desktop .rail-divider {
  width: 32px;
  height: 1.5px;
  background-color: var(--border-color);
  opacity: 0.4;
  margin: 2px 0;
}

.account-rail-mobile .rail-divider {
  width: 1.5px;
  height: 28px;
  background-color: var(--border-color);
  opacity: 0.4;
  margin: 0 2px;
}

.rail-tooltip-content {
  line-height: 1.3;
  padding: 2px 0;
}
</style>
