import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { subscribeQR } from '../src/composables/zalo-qr-subscription';

type Ack = (error: Error | null, result?: { ok: boolean; error?: string }) => void;

/** Socket boundary double: the test explicitly releases connection and server acknowledgment. */
function socketBoundary(connected = true) {
  const connectListeners = new Set<() => void>();
  let acknowledge: Ack | undefined;
  const boundary = {
    connected,
    connect: vi.fn(),
    once: vi.fn((_event: string, listener: () => void) => { connectListeners.add(listener); }),
    off: vi.fn((_event: string, listener: () => void) => { connectListeners.delete(listener); }),
    timeout: vi.fn((_milliseconds: number) => ({
      emit: emit,
    })),
  };
  function emit(_event: string, _data: unknown, callback: Ack) { acknowledge = callback; }
  const emitSpy = vi.fn(emit);
  boundary.timeout.mockImplementation(() => ({ emit: emitSpy }));
  return {
    socket: boundary as unknown as Socket,
    boundary, emit: emitSpy, connectListeners,
    connectNow() {
      boundary.connected = true;
      for (const listener of [...connectListeners]) listener();
    },
    ack(error: Error | null, result?: { ok: boolean; error?: string }) {
      if (!acknowledge) throw new Error('No pending acknowledgment');
      acknowledge(error, result);
    },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('QR subscription acknowledgment boundary', () => {
  it('does not release the login gate until a successful server acknowledgment', async () => {
    const transport = socketBoundary();
    let released = false;
    const pending = subscribeQR(transport.socket, 'account-a', () => true)
      .then(result => { released = result; return result; });
    await Promise.resolve();
    expect(transport.emit).toHaveBeenCalledWith('zalo:subscribe', { accountId: 'account-a' }, expect.any(Function));
    expect(transport.boundary.timeout).toHaveBeenCalledWith(5000);
    expect(released).toBe(false);
    transport.ack(null, { ok: true });
    await expect(pending).resolves.toBe(true);
    expect(released).toBe(true);
  });

  it.each([
    { result: { ok: false, error: 'forbidden' }, expected: 'forbidden' },
    { result: { ok: false }, expected: 'Không thể đăng ký nhận mã QR' },
    { result: undefined, expected: 'Không thể đăng ký nhận mã QR' },
  ])('rejects an unsuccessful or missing acknowledgment: $expected', async ({ result, expected }) => {
    const transport = socketBoundary();
    const pending = subscribeQR(transport.socket, 'account-a', () => true);
    const rejected = expect(pending).rejects.toThrow(expected);
    transport.ack(null, result);
    await rejected;
    expect(transport.emit).toHaveBeenCalledTimes(1);
  });

  it('rejects the socket acknowledgment timeout without replaying subscribe', async () => {
    const transport = socketBoundary();
    const pending = subscribeQR(transport.socket, 'account-a', () => true);
    const rejected = expect(pending).rejects.toThrow('Không thể đăng ký nhận mã QR');
    transport.ack(new Error('operation has timed out'));
    await rejected;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(transport.emit).toHaveBeenCalledTimes(1);
  });

  it('does not replay an intent cancelled while waiting for connection', async () => {
    const transport = socketBoundary(false);
    let active = true;
    const pending = subscribeQR(transport.socket, 'account-a', () => active);
    expect(transport.emit).not.toHaveBeenCalled();
    expect(transport.boundary.connect).toHaveBeenCalledTimes(1);
    active = false;
    transport.connectNow();
    await expect(pending).resolves.toBe(false);
    expect(transport.emit).not.toHaveBeenCalled();
    expect(transport.connectListeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not release a cancelled intent after a late successful acknowledgment', async () => {
    const transport = socketBoundary();
    let active = true;
    const pending = subscribeQR(transport.socket, 'account-a', () => active);
    active = false;
    transport.ack(null, { ok: true });
    await expect(pending).resolves.toBe(false);
    expect(transport.emit).toHaveBeenCalledTimes(1);
  });

  it('connection timeout removes the listener and cannot subscribe on a later connection', async () => {
    const transport = socketBoundary(false);
    const pending = subscribeQR(transport.socket, 'account-a', () => true);
    const rejected = expect(pending).rejects.toThrow('Không thể kết nối realtime');
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(transport.connectListeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    transport.connectNow();
    expect(transport.emit).not.toHaveBeenCalled();
  });
});
