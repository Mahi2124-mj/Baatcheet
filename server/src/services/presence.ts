// Who is here right now, WhatsApp style: a user is "online" while at least one of their sockets has the
// app visible on screen. A tab in the background or a phone with the screen off still has a connection
// (so calls can ring it) but counts as away: last seen is set and pushes are sent.
// Kept in memory: with several API servers, use the Socket.IO Redis adapter and move this map to Redis.
const users = new Map<string, Map<string, boolean>>(); // userId -> socketId -> app visible

const anyVisible = (m: Map<string, boolean> | undefined) => !!m && [...m.values()].some(Boolean);

/** Records a socket. Returns 'up' when the user just became online (visible somewhere). */
export function addSocket(userId: string, socketId: string, visible: boolean): 'up' | null {
  const m = users.get(userId) ?? new Map<string, boolean>();
  const before = anyVisible(m);
  m.set(socketId, visible);
  users.set(userId, m);
  return !before && anyVisible(m) ? 'up' : null;
}

/** The app was shown or hidden on one socket. Returns the change in "online", if any. */
export function setVisible(userId: string, socketId: string, visible: boolean): 'up' | 'down' | null {
  const m = users.get(userId);
  if (!m?.has(socketId)) return null;
  const before = anyVisible(m);
  m.set(socketId, visible);
  const after = anyVisible(m);
  return before === after ? null : after ? 'up' : 'down';
}

/** A socket went away. Returns 'down' when that left the user with nothing visible. */
export function removeSocket(userId: string, socketId: string): 'down' | null {
  const m = users.get(userId);
  if (!m) return null;
  const before = anyVisible(m);
  m.delete(socketId);
  if (!m.size) users.delete(userId);
  return before && !anyVisible(m) ? 'down' : null;
}

/** Online = the app is open on screen on at least one device. */
export const isOnline = (userId: string) => anyVisible(users.get(userId));
/** Has any live connection, even in the background (an incoming call can ring there). */
export const isConnected = (userId: string) => (users.get(userId)?.size ?? 0) > 0;
export const onlineCount = () => [...users.values()].filter(anyVisible).length;
export const resetPresence = () => users.clear();
