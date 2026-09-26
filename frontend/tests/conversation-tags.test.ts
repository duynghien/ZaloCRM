import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useConversationTags } from '../src/composables/use-conversation-tags';
import { getContrastTextColor } from '../src/utils/account-colors';
import { api } from '@/api/index';

const socketHandlers: Record<string, Function> = {};
const mockSocket = {
  on: vi.fn((event: string, handler: Function) => {
    socketHandlers[event] = handler;
  }),
  off: vi.fn(),
  emit: vi.fn(),
  connected: true,
};

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
  getSharedSocket: () => mockSocket,
  initSharedSocket: () => mockSocket,
  closeSharedSocket: vi.fn(),
}));

describe('Conversation Tags Frontend Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Color Contrast Utilities', () => {
    it('returns high-contrast text color based on luminance', () => {
      // Dark background -> White text
      expect(getContrastTextColor('#000000')).toBe('#FFFFFF');
      expect(getContrastTextColor('#1E3A8A')).toBe('#FFFFFF'); // Navy
      expect(getContrastTextColor('#111827')).toBe('#FFFFFF');

      // Light background -> Dark text
      expect(getContrastTextColor('#FFFFFF')).toBe('#111827');
      expect(getContrastTextColor('#FEF08A')).toBe('#111827'); // Light yellow
      expect(getContrastTextColor('#E5E7EB')).toBe('#111827'); // Light gray
    });
  });

  describe('useConversationTags Composable', () => {
    it('loads and sorts tags alphabetically by Vietnamese collation', async () => {
      vi.mocked(api.get).mockResolvedValueOnce({
        data: {
          tags: [
            { id: 't2', orgId: 'org-1', name: 'Đã chốt', color: '#10B981', createdAt: '', updatedAt: '' },
            { id: 't1', orgId: 'org-1', name: 'Chờ cọc', color: '#EF4444', createdAt: '', updatedAt: '' },
            { id: 't3', orgId: 'org-1', name: 'Khách VIP', color: '#F59E0B', createdAt: '', updatedAt: '' },
          ],
        },
      });

      const { tags, loadTags } = useConversationTags();
      await loadTags(true);

      expect(tags.value).toHaveLength(3);
      expect(tags.value[0].name).toBe('Chờ cọc');
      expect(tags.value[1].name).toBe('Đã chốt');
      expect(tags.value[2].name).toBe('Khách VIP');
    });

    it('toggles active tag filter', () => {
      const { activeTagId, setActiveTag, activeTag, tags } = useConversationTags();
      tags.value = [
        { id: 't1', orgId: 'org-1', name: 'Chờ cọc', color: '#EF4444', createdAt: '', updatedAt: '' },
      ];

      setActiveTag('t1');
      expect(activeTagId.value).toBe('t1');
      expect(activeTag.value?.name).toBe('Chờ cọc');

      // Toggle off if clicking the same tag
      setActiveTag('t1');
      expect(activeTagId.value).toBeNull();
      expect(activeTag.value).toBeNull();
    });

    it('creates a new tag and adds it to local list', async () => {
      const newTag = { id: 't4', orgId: 'org-1', name: 'Cần gọi lại', color: '#8B5CF6', createdAt: '', updatedAt: '' };
      vi.mocked(api.post).mockResolvedValueOnce({ data: newTag });

      const { tags, createTag } = useConversationTags();
      const res = await createTag({ name: 'Cần gọi lại', color: '#8B5CF6' });

      expect(res.id).toBe('t4');
      expect(tags.value.some((t) => t.id === 't4')).toBe(true);
    });

    it('deletes a tag and clears activeTagId if it was active', async () => {
      vi.mocked(api.delete).mockResolvedValueOnce({ data: { success: true } });

      const { tags, activeTagId, setActiveTag, deleteTag } = useConversationTags();
      tags.value = [
        { id: 'tag-del', orgId: 'org-1', name: 'Tạm xóa', color: '#EF4444', createdAt: '', updatedAt: '' },
      ];
      setActiveTag('tag-del');
      expect(activeTagId.value).toBe('tag-del');

      const success = await deleteTag('tag-del');
      expect(success).toBe(true);
      expect(tags.value.find((t) => t.id === 'tag-del')).toBeUndefined();
      expect(activeTagId.value).toBeNull();
    });

    it('handles socket conversation:tag-deleted by purging tag and resetting filter (Ghost Tag Defense)', async () => {
      const { tags, activeTagId, setActiveTag, loadTags } = useConversationTags();
      // Ensure listeners initialized
      await loadTags();

      tags.value = [
        { id: 'ghost-tag', orgId: 'org-1', name: 'Nhãn sắp xóa', color: '#000000', createdAt: '', updatedAt: '' },
        { id: 'other-tag', orgId: 'org-1', name: 'Nhãn còn lại', color: '#10B981', createdAt: '', updatedAt: '' },
      ];
      setActiveTag('ghost-tag');

      // Simulate incoming socket event
      if (socketHandlers['conversation:tag-deleted']) {
        socketHandlers['conversation:tag-deleted']({ tagId: 'ghost-tag' });
      }

      expect(tags.value.find((t) => t.id === 'ghost-tag')).toBeUndefined();
      expect(tags.value).toHaveLength(1);
      expect(activeTagId.value).toBeNull();
    });

    it('assigns and unassigns tag with local count tracking', async () => {
      const { tags, assignTag, unassignTag } = useConversationTags();
      tags.value = [
        { id: 't-count', orgId: 'org-1', name: 'Đếm', color: '#000', createdAt: '', updatedAt: '', _count: { assignments: 2 } },
      ];

      vi.mocked(api.post).mockResolvedValueOnce({ data: { tags: [] } });
      await assignTag('conv-1', 't-count');
      expect(tags.value[0]._count?.assignments).toBe(3);

      vi.mocked(api.delete).mockResolvedValueOnce({ data: { tags: [] } });
      await unassignTag('conv-1', 't-count');
      expect(tags.value[0]._count?.assignments).toBe(2);
    });
  });
});
