// Access to the Socket.IO server from HTTP routes and services.
import type { Server } from 'socket.io';
import type { ClientToServer, ServerToClient } from '@baatcheet/shared';

export type IO = Server<ClientToServer, ServerToClient, Record<string, never>, { userId: string; sessionId: string }>;

let server: IO | null = null;
export const setIo = (s: IO | null) => {
  server = s;
};
export const io = () => server;

export const userRoom = (id: string) => `user:${id}`;
export const convRoom = (id: string) => `conv:${id}`;

type Emit = Parameters<IO['emit']>;
export function toUser<E extends keyof ServerToClient>(userId: string, event: E, ...args: Parameters<ServerToClient[E]>) {
  (server?.to(userRoom(userId)).emit as ((...a: unknown[]) => void) | undefined)?.(event, ...args);
}
export function toConversation<E extends keyof ServerToClient>(convId: string, event: E, ...args: Parameters<ServerToClient[E]>) {
  (server?.to(convRoom(convId)).emit as ((...a: unknown[]) => void) | undefined)?.(event, ...args);
}
export function joinRoom(userId: string, convId: string) {
  server?.in(userRoom(userId)).socketsJoin(convRoom(convId));
}
export function leaveRoom(userId: string, convId: string) {
  server?.in(userRoom(userId)).socketsLeave(convRoom(convId));
}
export function disconnectSession(sessionId: string) {
  if (!server) return;
  for (const s of server.sockets.sockets.values()) {
    if (s.data.sessionId === sessionId) {
      s.emit('session:revoked');
      s.disconnect(true);
    }
  }
}
export function disconnectUser(userId: string) {
  server?.in(userRoom(userId)).emit('session:revoked');
  server?.in(userRoom(userId)).disconnectSockets(true);
}
export type { Emit };
