import type { Ref } from 'vue';
import { api } from '@/api/index';
import type { Conversation, Message } from './use-chat';

type State = {
  conversations: Ref<Conversation[]>; selectedConvId: Ref<string | null>; messages: Ref<Message[]>;
  loadingConvs: Ref<boolean>; loadingMsgs: Ref<boolean>;
  searchQuery: Ref<string>; accountFilter: Ref<string | null>; tagFilter?: Ref<string | null>;
};

const unavailable = (error: unknown) => [403, 404].includes(
  (error as { response?: { status?: number } })?.response?.status || 0,
);

/** One active REST snapshot, at most one follow-up per burst. New events invalidate old snapshots. */
export function useChatRecovery(state: State) {
  let revision = 0;
  let disposed = false;
  let dirty = false;
  let running: Promise<void> | null = null;
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  const cancelScheduled = () => { if (scheduled) clearTimeout(scheduled); scheduled = null; };
  const invalidate = () => { revision++; dirty = true; };

  async function snapshot() {
    const version = revision;
    const convId = state.selectedConvId.value;
    const search = state.searchQuery.value;
    const accountId = state.accountFilter.value;
    const tagId = state.tagFilter?.value;
    const current = () => !disposed && revision === version
      && state.selectedConvId.value === convId && search === state.searchQuery.value
      && accountId === state.accountFilter.value && tagId === state.tagFilter?.value;
    state.loadingConvs.value = true;
    state.loadingMsgs.value = !!convId;
    const [list, detail, messages] = await Promise.allSettled([
      api.get('/conversations', {
        params: {
          limit: 100,
          search,
          accountId: accountId || undefined,
          tagId: tagId || undefined,
        },
      }),
      convId ? api.get(`/conversations/${convId}`) : Promise.resolve(null),
      convId ? api.get(`/conversations/${convId}/messages`, { params: { limit: 100 } }) : Promise.resolve(null),
    ]);
    if (!current()) return;
    // An explicit denial invalidates the entire active view before any successful stale data is applied.
    const denied = (detail.status === 'rejected' && unavailable(detail.reason))
      || (messages.status === 'rejected' && unavailable(messages.reason));
    if (list.status === 'fulfilled') state.conversations.value = list.value.data.conversations;
    else if (unavailable(list.reason)) state.conversations.value = [];
    else console.error('Failed to recover conversations:', list.reason);
    if (denied || (list.status === 'rejected' && unavailable(list.reason))) {
      state.conversations.value = state.conversations.value.filter(conv => conv.id !== convId);
      state.selectedConvId.value = null;
      state.messages.value = [];
      // Clearing an active selection invalidates pending work once. An already
      // empty denied view must stay clean, otherwise persistent denial retries forever.
      if (convId !== null) invalidate();
      return;
    }
    if (detail.status === 'fulfilled' && detail.value) {
      const conv = state.conversations.value.find(item => item.id === convId);
      if (conv) Object.assign(conv, detail.value.data);
    } else if (detail.status === 'rejected') console.error('Failed to recover conversation:', detail.reason);
    if (messages.status === 'fulfilled' && messages.value) {
      state.messages.value = [...new Map<string, Message>(
        messages.value.data.messages.map((message: Message) => [message.id, message]),
      ).values()];
    } else if (messages.status === 'rejected') console.error('Failed to recover messages:', messages.reason);
  }

  function request(): Promise<void> {
    if (disposed) return Promise.resolve();
    invalidate();
    if (running) return running;
    cancelScheduled();
    running = (async () => {
      for (let pass = 0; pass < 2 && dirty && !disposed; pass++) {
        dirty = false;
        await snapshot();
      }
    })().finally(() => {
      running = null;
      state.loadingConvs.value = false;
      state.loadingMsgs.value = false;
      // A change during the second pass still needs catch-up. Yield and coalesce a new
      // burst; failed requests alone never set dirty and therefore never retry.
      if (dirty && !disposed) scheduled = setTimeout(() => { scheduled = null; void request(); }, 100);
    });
    return running;
  }
  return { request, invalidate, cancel: () => { revision++; dirty = false; cancelScheduled(); }, generation: () => revision, dispose: () => { disposed = true; cancelScheduled(); invalidate(); } };
}
