import type { Socket } from 'socket.io-client';

/** Do not buffer login intent while disconnected: cancellation must prevent later replay. */
export async function subscribeQR(socket: Socket, accountId: string, current: () => boolean): Promise<boolean> {
  if (!socket.connected) {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); socket.off('connect', connected); };
      const connected = () => { cleanup(); resolve(); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Không thể kết nối realtime')); }, 5000);
      socket.once('connect', connected);
      socket.connect();
    });
  }
  if (!current()) return false;
  await new Promise<void>((resolve, reject) => {
    socket.timeout(5000).emit('zalo:subscribe', { accountId },
      (error: Error | null, ack?: { ok: boolean; error?: string }) => {
        if (error || !ack?.ok) reject(new Error(ack?.error || 'Không thể đăng ký nhận mã QR'));
        else resolve();
      });
  });
  return current();
}
