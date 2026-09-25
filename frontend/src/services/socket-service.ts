import { io, Socket } from 'socket.io-client';
import { getAccessToken, refreshAccessToken, isSocketAuthenticationFailure } from '../api/index';

let sharedSocket: Socket | null = null;
let lastSocketRefresh = 0;
let socketRefreshAttempted = false;
let isListenerAttached = false;

function handleTokenChanged(e: Event) {
  const customEvent = e as CustomEvent<string>;
  const token = customEvent.detail;
  if (!token) {
    if (sharedSocket) {
      sharedSocket.disconnect();
    }
    return;
  }

  if (sharedSocket) {
    socketRefreshAttempted = false;
    sharedSocket.disconnect();
    sharedSocket.connect();
  } else {
    initSharedSocket();
  }
}

/**
 * Initializes or returns the shared singleton Socket.IO connection.
 * Reduces server connection overhead by sharing 1 connection across all composables and stores.
 */
export function initSharedSocket(): Socket | null {
  const token = getAccessToken();
  if (typeof window === 'undefined') return null;

  if (!isListenerAttached) {
    window.addEventListener('zalo-crm:access-token-changed', handleTokenChanged as EventListener);
    window.addEventListener('online', () => {
      socketRefreshAttempted = false;
      if (sharedSocket && !sharedSocket.connected && getAccessToken()) {
        sharedSocket.connect();
      }
    });
    isListenerAttached = true;
  }

  if (!token) return null;

  if (sharedSocket?.connected) {
    return sharedSocket;
  }

  if (!sharedSocket) {
    sharedSocket = io({
      auth: (callback) => callback({ token: getAccessToken() }),
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
    });

    sharedSocket.on('connect', () => {
      socketRefreshAttempted = false;
    });

    sharedSocket.on('disconnect', async (reason) => {
      if (reason !== 'io server disconnect' || !sharedSocket || !getAccessToken()) return;
      const now = Date.now();
      if (lastSocketRefresh && now - lastSocketRefresh < 5000) return;
      lastSocketRefresh = now;
      const disconnected = sharedSocket;
      try {
        await refreshAccessToken();
        if (sharedSocket === disconnected) sharedSocket.connect();
      } catch {
        // Handled by API layer
      }
    });

    sharedSocket.on('connect_error', async (error) => {
      const unauthorized = isSocketAuthenticationFailure(error.message);
      if (!unauthorized || socketRefreshAttempted || !sharedSocket) return;

      const now = Date.now();
      if (lastSocketRefresh && now - lastSocketRefresh < 5000) return;
      lastSocketRefresh = now;
      socketRefreshAttempted = true;
      try {
        await refreshAccessToken();
        sharedSocket?.connect();
      } catch {
        // Handled by API layer
      }
    });
  }

  return sharedSocket;
}

/**
 * Retrieves the singleton Socket instance, initializing it if an access token is present.
 */
export function getSharedSocket(): Socket | null {
  if (!sharedSocket) {
    return initSharedSocket();
  }
  return sharedSocket;
}

/**
 * Cleanly disconnects and discards the singleton socket instance.
 */
export function closeSharedSocket(): void {
  if (sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
  }
}
