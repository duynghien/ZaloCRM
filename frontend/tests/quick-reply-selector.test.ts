import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useQuickReplyTrigger } from '../src/composables/use-quick-reply-trigger';
import { useQuickReplies } from '../src/composables/use-quick-replies';

vi.mock('@/api/index', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
  getAccessToken: () => 'fake-token',
  refreshAccessToken: vi.fn(),
  isSocketAuthenticationFailure: () => false,
}));

vi.mock('../src/services/socket-service', () => ({
  getSharedSocket: () => null,
  initSharedSocket: () => null,
  closeSharedSocket: vi.fn(),
}));

describe('QuickReply Frontend Composables & Keyboard Interaction', () => {
  describe('useQuickReplyTrigger', () => {
    it('detects / at start of line or after space and sets query', () => {
      let text = '';
      const { showSelector, query, checkTrigger } = useQuickReplyTrigger(
        () => text,
        (val) => { text = val; }
      );

      checkTrigger('/stk');
      expect(showSelector.value).toBe(true);
      expect(query.value).toBe('stk');

      checkTrigger('Chào bạn /dia');
      expect(showSelector.value).toBe(true);
      expect(query.value).toBe('dia');

      checkTrigger('https://google.com/test');
      expect(showSelector.value).toBe(false);
      expect(query.value).toBe('');
    });

    it('ignores navigation and enter keys when isComposing is true (IME Vietnamese protection)', () => {
      let text = '/stk';
      const onSend = vi.fn();
      const mockSelector = {
        navigateDown: vi.fn(),
        navigateUp: vi.fn(),
        selectCurrent: vi.fn().mockReturnValue(true),
      };

      const { isComposing, showSelector, handleKeydown } = useQuickReplyTrigger(
        () => text,
        (val) => { text = val; }
      );

      showSelector.value = true;
      isComposing.value = true;

      const enterEvent = {
        key: 'Enter',
        isComposing: true,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as any;

      const handled = handleKeydown(enterEvent, mockSelector, onSend);
      expect(handled).toBe(false);
      expect(mockSelector.selectCurrent).not.toHaveBeenCalled();
      expect(onSend).not.toHaveBeenCalled();
    });

    it('delegates ArrowDown and Enter to selector when open and not composing', () => {
      let text = '/stk';
      const onSend = vi.fn();
      const mockSelector = {
        navigateDown: vi.fn(),
        navigateUp: vi.fn(),
        selectCurrent: vi.fn().mockReturnValue(true),
      };

      const { isComposing, showSelector, handleKeydown } = useQuickReplyTrigger(
        () => text,
        (val) => { text = val; }
      );

      showSelector.value = true;
      isComposing.value = false;

      const downEvent = {
        key: 'ArrowDown',
        isComposing: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as any;

      handleKeydown(downEvent, mockSelector, onSend);
      expect(downEvent.preventDefault).toHaveBeenCalled();
      expect(mockSelector.navigateDown).toHaveBeenCalled();

      const enterEvent = {
        key: 'Enter',
        isComposing: false,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as any;

      handleKeydown(enterEvent, mockSelector, onSend);
      expect(enterEvent.preventDefault).toHaveBeenCalled();
      expect(mockSelector.selectCurrent).toHaveBeenCalled();
      expect(onSend).not.toHaveBeenCalled();
    });

    it('replaces /shortcut with selected template content', () => {
      let text = 'Dạ STK của bên em là /stk';
      const { insertReply, showSelector } = useQuickReplyTrigger(
        () => text,
        (val) => { text = val; }
      );

      showSelector.value = true;
      insertReply({
        id: '1',
        orgId: 'org-1',
        shortcut: 'stk',
        title: 'STK Techcombank',
        content: 'Techcombank: 19030001234567 - Nguyen Van A',
        category: 'payment',
        createdAt: '2026-09-26T00:00:00Z',
        updatedAt: '2026-09-26T00:00:00Z',
      });

      expect(text).toBe('Dạ STK của bên em là Techcombank: 19030001234567 - Nguyen Van A');
      expect(showSelector.value).toBe(false);
    });
  });

  describe('useQuickReplies filtering', () => {
    it('filters templates and prioritizes prefix matching', async () => {
      const { setQuickRepliesForTest, filterQuickReplies } = useQuickReplies();

      setQuickRepliesForTest([
        { id: '1', orgId: 'org-1', shortcut: 'stk_vcb', title: 'Vietcombank', content: '...', category: 'payment', createdAt: '', updatedAt: '' },
        { id: '2', orgId: 'org-1', shortcut: 'stk_tcb', title: 'Techcombank', content: '...', category: 'payment', createdAt: '', updatedAt: '' },
        { id: '3', orgId: 'org-1', shortcut: 'menu_combo', title: 'Menu món ăn', content: '...', category: 'pricing', createdAt: '', updatedAt: '' },
        { id: '4', orgId: 'org-1', shortcut: 'baogia_stk', title: 'Báo giá kèm stk', content: '...', category: 'pricing', createdAt: '', updatedAt: '' },
      ]);

      const results = filterQuickReplies('stk');
      expect(results.length).toBe(3);
      // 'stk_vcb' and 'stk_tcb' must precede 'baogia_stk' because their shortcut starts with 'stk'
      expect(results[0].shortcut.startsWith('stk')).toBe(true);
      expect(results[1].shortcut.startsWith('stk')).toBe(true);
      expect(results[2].shortcut).toBe('baogia_stk');
    });

    it('filters by category', () => {
      const { setQuickRepliesForTest, filterQuickReplies } = useQuickReplies();

      setQuickRepliesForTest([
        { id: '1', orgId: 'org-1', shortcut: 'stk', title: 'STK', content: '...', category: 'payment', createdAt: '', updatedAt: '' },
        { id: '2', orgId: 'org-1', shortcut: 'diachi', title: 'Địa chỉ kho', content: '...', category: 'address', createdAt: '', updatedAt: '' },
      ]);

      const paymentOnly = filterQuickReplies('', 'payment');
      expect(paymentOnly).toHaveLength(1);
      expect(paymentOnly[0].shortcut).toBe('stk');
    });
  });
});
