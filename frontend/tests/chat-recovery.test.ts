import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import type { Conversation, Message } from '../src/composables/use-chat';
import { useChatRecovery } from '../src/composables/use-chat-recovery';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/api/index', () => ({ api: { get } }));

const conversation = (id: string): Conversation => ({
  id, contact: null, zaloAccount: { id: 'account', displayName: null },
  threadType: 'user', lastMessageAt: null, unreadCount: 0, isReplied: false,
});
const message = (id: string): Message => ({
  id, content: id, contentType: 'text', senderType: 'user', senderName: null,
  sentAt: '2026-09-08T00:00:00Z', isDeleted: false, zaloMsgId: id,
});
const list = (id: string) => ({ data: { conversations: [conversation(id)] } });
const denial = (status = 403) => ({ response: { status } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(active: string | null = null) {
  const state = {
    conversations: ref<Conversation[]>(active ? [conversation(active)] : []),
    selectedConvId: ref<string | null>(active), messages: ref<Message[]>(active ? [message('old')] : []),
    loadingConvs: ref(false), loadingMsgs: ref(false), searchQuery: ref(''), accountFilter: ref<string | null>(null),
  };
  return { state, recovery: useChatRecovery(state) };
}
async function flush() { for (let index = 0; index < 10; index++) await Promise.resolve(); }

beforeEach(() => { vi.useFakeTimers(); get.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

describe('REST chat recovery', () => {
  it.each([403, 404])('persistent list %s stops after clearing selection', async status => {
    const { state, recovery } = fixture('active');
    get.mockRejectedValue(denial(status));
    await recovery.request();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.selectedConvId.value).toBeNull();
    expect(state.messages.value).toEqual([]);
    expect(state.conversations.value).toEqual([]);
    expect(get.mock.calls.filter(([url]) => url === '/conversations')).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
    recovery.dispose();
  });

  it('persistent denial with no active view does not create follow-up work', async () => {
    const { recovery } = fixture();
    get.mockRejectedValue(denial());
    await recovery.request();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(get).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    recovery.dispose();
  });

  it('recovers a change during the second pass after a bounded trailing delay', async () => {
    const { state, recovery } = fixture();
    const first = deferred<ReturnType<typeof list>>();
    const second = deferred<ReturnType<typeof list>>();
    get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue(list('latest'));
    const pending = recovery.request();
    void recovery.request();
    first.resolve(list('stale-first'));
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    void recovery.request();
    second.resolve(list('stale-second'));
    await pending;
    expect(state.conversations.value).toEqual([]);
    expect(get).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(state.conversations.value.map(conv => conv.id)).toEqual(['latest']);
    expect(get).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(get).toHaveBeenCalledTimes(3);
    recovery.dispose();
  });

  it('discarded success cannot restore a view denied by the current snapshot', async () => {
    const { state, recovery } = fixture('active');
    const oldMessages = deferred<{ data: { messages: Message[] } }>();
    let messageReads = 0;
    get.mockImplementation((url: string) => {
      if (url === '/conversations') return Promise.resolve(list('active'));
      if (url.endsWith('/messages')) return ++messageReads === 1
        ? oldMessages.promise : Promise.reject(denial());
      return Promise.resolve({ data: conversation('active') });
    });
    const pending = recovery.request();
    void recovery.request();
    oldMessages.resolve({ data: { messages: [message('stale-secret')] } });
    await pending;
    expect(state.selectedConvId.value).toBeNull();
    expect(state.messages.value).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(state.selectedConvId.value).toBeNull();
    expect(state.messages.value).toEqual([]);
    recovery.dispose();
  });

  it('a stale denial does not clear a newly selected conversation', async () => {
    const { state, recovery } = fixture('old');
    let rejectOld!: (reason: unknown) => void;
    const rejected = new Promise((_resolve, reject) => { rejectOld = reject; });
    get.mockImplementation((url: string) => {
      if (url === '/conversations') return Promise.resolve(list(state.selectedConvId.value || 'new'));
      if (url === '/conversations/old') return rejected;
      if (url.endsWith('/messages')) return Promise.resolve({ data: { messages: [message('new-message')] } });
      return Promise.resolve({ data: conversation('new') });
    });
    const pending = recovery.request();
    state.selectedConvId.value = 'new';
    void recovery.request();
    rejectOld(denial());
    await pending;
    expect(state.selectedConvId.value).toBe('new');
    expect(state.messages.value[0]?.id).toBe('new-message');
    recovery.dispose();
  });

  it('a server error alone never triggers a retry', async () => {
    const { recovery } = fixture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    get.mockRejectedValue(denial(500));
    await recovery.request();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(get).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    recovery.dispose();
  });

  it('replaces message deletion state from the database and deduplicates IDs', async () => {
    const { state, recovery } = fixture('active');
    get.mockImplementation((url: string) => Promise.resolve(url === '/conversations' ? list('active')
      : url.endsWith('/messages') ? { data: { messages: [message('same'), { ...message('same'), isDeleted: true }] } }
        : { data: conversation('active') }));
    await recovery.request();
    expect(state.messages.value).toHaveLength(1);
    expect(state.messages.value[0]?.isDeleted).toBe(true);
    recovery.dispose();
  });

  it('dispose discards in-flight data and cancels recovery work', async () => {
    const { state, recovery } = fixture();
    const response = deferred<ReturnType<typeof list>>();
    get.mockReturnValue(response.promise);
    const pending = recovery.request();
    void recovery.request();
    recovery.dispose();
    response.resolve(list('late'));
    await pending;
    await vi.advanceTimersByTimeAsync(10_000);
    await recovery.request();
    expect(state.conversations.value).toEqual([]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
