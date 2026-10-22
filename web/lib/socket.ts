'use client';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServer, ServerToClient } from '@baatcheet/shared';

export type AppSocket = Socket<ServerToClient, ClientToServer>;

let socket: AppSocket | null = null;

/** One authenticated Socket.IO connection per tab (uses the session cookie). */
export function getSocket(): AppSocket {
  if (socket) return socket;
  const url = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;
  socket = io(url ?? '', {
    withCredentials: true,
    transports: ['websocket', 'polling'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 8000,
  });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}

export function emitAck<T>(event: keyof ClientToServer, payload: unknown, timeoutMs = 10_000): Promise<T> {
  const s = getSocket();
  return new Promise((resolve, reject) => {
    (s.timeout(timeoutMs) as unknown as { emit: (...a: unknown[]) => void }).emit(event, payload, (err: unknown, res: { ok: boolean; data?: T; error?: string }) => {
      if (err) return reject(new Error('No answer from the server — check your connection'));
      if (!res?.ok) return reject(new Error(res?.error ?? 'Something went wrong'));
      resolve(res.data as T);
    });
  });
}
