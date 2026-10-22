// Who is connected right now. Kept in memory: with several API servers, use the Socket.IO Redis adapter
// and move this map to Redis.
const sockets = new Map<string, number>();

export function connected(userId: string): boolean {
  const n = (sockets.get(userId) ?? 0) + 1;
  sockets.set(userId, n);
  return n === 1;
}

/** Returns true when the user's last socket went away. */
export function disconnected(userId: string): boolean {
  const n = (sockets.get(userId) ?? 1) - 1;
  if (n <= 0) {
    sockets.delete(userId);
    return true;
  }
  sockets.set(userId, n);
  return false;
}

export const isOnline = (userId: string) => (sockets.get(userId) ?? 0) > 0;
export const onlineCount = () => sockets.size;
export const resetPresence = () => sockets.clear();
