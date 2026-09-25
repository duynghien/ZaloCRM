import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateContactAvatar } from '../../src/modules/zalo/zalo-message-helpers.js';
import { prisma } from '../../src/shared/database/prisma-client.js';

vi.mock('../../src/shared/database/prisma-client.js', () => ({
  prisma: {
    contact: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}));

describe('Contact Avatar Scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes contact avatar update to orgId when provided', () => {
    updateContactAvatar('zalo-uid-1', 'https://avatar.test/img.png', 'org-tenant-123');

    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: {
        zaloUid: 'zalo-uid-1',
        orgId: 'org-tenant-123',
        avatarUrl: null,
      },
      data: {
        avatarUrl: 'https://avatar.test/img.png',
      },
    });
  });

  it('updates without orgId filter when orgId is omitted', () => {
    updateContactAvatar('zalo-uid-1', 'https://avatar.test/img.png');

    expect(prisma.contact.updateMany).toHaveBeenCalledWith({
      where: {
        zaloUid: 'zalo-uid-1',
        avatarUrl: null,
      },
      data: {
        avatarUrl: 'https://avatar.test/img.png',
      },
    });
  });
});
