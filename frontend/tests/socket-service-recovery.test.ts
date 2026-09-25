import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const eventListeners = new Map<string, Function[]>();
const mockWindow: any = {
  addEventListener: vi.fn((event: string, cb: Function) => {
    if (!eventListeners.has(event)) eventListeners.set(event, []);
    eventListeners.get(event)!.push(cb);
  }),
  removeEventListener: vi.fn((event: string, cb: Function) => {
    const list = eventListeners.get(event) || [];
    eventListeners.set(event, list.filter(fn => fn !== cb));
  }),
  dispatchEvent: vi.fn((e: any) => {
    const list = eventListeners.get(e.type) || [];
    list.forEach(fn => fn(e));
    return true;
  }),
};

(global as any).window = mockWindow;
(global as any).Event = class Event {
  type: string;
  constructor(type: string) {
    this.type = type;
  }
} as any;
(global as any).CustomEvent = class CustomEvent {
  type: string;
  detail: any;
  constructor(type: string, init?: any) {
    this.type = type;
    this.detail = init?.detail;
  }
} as any;

const mockSocket: any = {
  connected: false,
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocket),
}));

import { initSharedSocket, closeSharedSocket } from '../src/services/socket-service';
import { setAccessToken, clearAccessToken } from '../src/api/index';
import { io } from 'socket.io-client';

describe('SocketService Network Flap Recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventListeners.clear();
    closeSharedSocket();
    setAccessToken('test-jwt-token');
    mockSocket.connected = false;
  });

  afterEach(() => {
    closeSharedSocket();
    clearAccessToken();
  });

  it('re-arms connection attempt when browser fires online event', () => {
    const socket = initSharedSocket();
    expect(socket).not.toBeNull();
    expect(io).toHaveBeenCalledTimes(1);

    mockSocket.connect.mockClear();

    // Trigger browser online event
    mockWindow.dispatchEvent(new (global as any).Event('online'));

    expect(mockSocket.connect).toHaveBeenCalledTimes(1);
  });
});
