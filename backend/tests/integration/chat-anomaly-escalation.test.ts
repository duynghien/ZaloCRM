/**
 * chat-anomaly-escalation.test.ts — Integration tests for anomaly escalation, manager RBAC, and resolve endpoint.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://crmuser:password@localhost:5432/zalocrm_test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_32_characters_long_12345';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { emitManagerEvent } from '../../src/shared/realtime/socket-event-delivery.js';
import * as socketAuth from '../../src/shared/realtime/socket-authorization.js';

describe('emitManagerEvent RBAC isolation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('delivers anomaly alerts only to owner and admin users, blocking member users', async () => {
    const emittedEvents: Record<string, any[]> = {
      adminSocket: [],
      ownerSocket: [],
      memberSocket: [],
    };

    const adminSocket: any = {
      id: 'socket-admin',
      emit: (ev: string, data: any) => emittedEvents.adminSocket.push({ ev, data }),
    };
    const ownerSocket: any = {
      id: 'socket-owner',
      emit: (ev: string, data: any) => emittedEvents.ownerSocket.push({ ev, data }),
    };
    const memberSocket: any = {
      id: 'socket-member',
      emit: (ev: string, data: any) => emittedEvents.memberSocket.push({ ev, data }),
    };

    const mockSockets = new Map<string, any>([
      ['socket-admin', adminSocket],
      ['socket-owner', ownerSocket],
      ['socket-member', memberSocket],
    ]);

    const mockIo: any = {
      sockets: {
        adapter: {
          rooms: new Map([
            ['org:org-test-1', new Set(['socket-admin', 'socket-owner', 'socket-member'])],
          ]),
        },
        sockets: mockSockets,
      },
    };

    vi.spyOn(socketAuth, 'socketSessionIsCurrent').mockReturnValue(true);
    vi.spyOn(socketAuth, 'currentSocketIdentity').mockImplementation(async (sock: any) => {
      if (sock.id === 'socket-admin') return { id: 'u-1', orgId: 'org-test-1', role: 'admin' } as any;
      if (sock.id === 'socket-owner') return { id: 'u-2', orgId: 'org-test-1', role: 'owner' } as any;
      return { id: 'u-3', orgId: 'org-test-1', role: 'member' } as any;
    });

    const alertPayload = {
      conversationId: 'conv-danger-1',
      severity: 'critical',
      reason: 'Khách dọa kiện vì lừa đảo',
    };

    await emitManagerEvent(mockIo, 'org-test-1', 'chat:anomaly_alert', alertPayload);

    // Verify admin and owner received event
    expect(emittedEvents.adminSocket.length).toBe(1);
    expect(emittedEvents.adminSocket[0].ev).toBe('chat:anomaly_alert');
    expect(emittedEvents.ownerSocket.length).toBe(1);
    expect(emittedEvents.ownerSocket[0].ev).toBe('chat:anomaly_alert');

    // Verify member was strictly blocked
    expect(emittedEvents.memberSocket.length).toBe(0);
  });
});
