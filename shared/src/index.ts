// Types and validation shared by the API server and the web app.
import { z } from 'zod';

export const LIMITS = {
  messageLength: 4000,
  groupName: 80,
  groupMembers: 256,
  bio: 300,
  displayName: 60,
  pageSize: 40,
  maxPageSize: 100,
  /** Bytes per attachment kind. */
  fileSize: {
    image: 10 * 1024 * 1024,
    video: 100 * 1024 * 1024,
    audio: 25 * 1024 * 1024,
    document: 25 * 1024 * 1024,
    avatar: 5 * 1024 * 1024,
  },
} as const;

/** Allowed upload types. Anything else is refused by the server. */
export const MIME_KINDS: Record<string, AttachmentKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
  'video/mp4': 'video',
  'video/webm': 'video',
  'video/quicktime': 'video',
  'audio/mpeg': 'audio',
  'audio/mp4': 'audio',
  'audio/ogg': 'audio',
  'audio/webm': 'audio',
  'audio/wav': 'audio',
  'application/pdf': 'document',
  'text/plain': 'document',
  'application/zip': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'application/vnd.ms-excel': 'document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
  'application/vnd.ms-powerpoint': 'document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
};

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document';
export type CallType = 'AUDIO' | 'VIDEO';
export type CallStatus = 'RINGING' | 'ONGOING' | 'ENDED' | 'MISSED' | 'REJECTED' | 'BUSY' | 'FAILED';
export type Visibility = 'EVERYONE' | 'CONTACTS' | 'NOBODY';
export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';

// ---------- input schemas ----------

export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_.]{3,24}$/, 'Username: 3–24 letters, numbers, _ or .');
export const email = z.string().trim().toLowerCase().email().max(254);
export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128)
  .refine((p) => /[a-zA-Z]/.test(p) && /[0-9]/.test(p), 'Use letters and numbers');

export const registerInput = z.object({
  email,
  password,
  username,
  displayName: z.string().trim().min(1).max(LIMITS.displayName),
});
export const loginInput = z.object({ email, password: z.string().min(1).max(128) });
export const resetInput = z.object({ token: z.string().min(10).max(200), password });

export const profileInput = z.object({
  displayName: z.string().trim().min(1).max(LIMITS.displayName).optional(),
  username: username.optional(),
  bio: z.string().trim().max(LIMITS.bio).optional(),
  avatarKey: z.string().max(300).nullable().optional(),
  onboarded: z.boolean().optional(),
});

export const privacyInput = z.object({
  lastSeenVisibility: z.enum(['EVERYONE', 'CONTACTS', 'NOBODY']).optional(),
  profileVisibility: z.enum(['EVERYONE', 'CONTACTS', 'NOBODY']).optional(),
  readReceipts: z.boolean().optional(),
  allowMessagesFrom: z.enum(['EVERYONE', 'CONTACTS']).optional(),
  notifyMessages: z.boolean().optional(),
  notifyCalls: z.boolean().optional(),
  notifyGroups: z.boolean().optional(),
});

export const sendMessageInput = z
  .object({
    conversationId: z.string().min(1).max(40),
    clientId: z.string().min(8).max(64),
    body: z.string().max(LIMITS.messageLength).optional(),
    replyToId: z.string().max(40).optional(),
    attachments: z
      .array(z.object({ key: z.string().max(300), name: z.string().max(200), size: z.number().int().positive(), mime: z.string().max(120) }))
      .max(10)
      .optional(),
  })
  .refine((m) => (m.body && m.body.trim().length > 0) || (m.attachments && m.attachments.length > 0), 'Empty message');

export const createGroupInput = z.object({
  name: z.string().trim().min(1).max(LIMITS.groupName),
  memberIds: z.array(z.string().max(40)).min(1).max(LIMITS.groupMembers - 1),
  avatarKey: z.string().max(300).optional(),
});

export const uploadRequestInput = z.object({
  name: z.string().trim().min(1).max(200),
  size: z.number().int().positive(),
  mime: z.string().max(120),
  purpose: z.enum(['attachment', 'avatar', 'group-avatar']),
});

export const reportInput = z.object({
  userId: z.string().max(40).optional(),
  messageId: z.string().max(40).optional(),
  conversationId: z.string().max(40).optional(),
  reason: z.enum(['SPAM', 'HARASSMENT', 'HATE', 'VIOLENCE', 'NUDITY', 'SCAM', 'OTHER']),
  details: z.string().max(1000).optional(),
});

// ---------- API shapes ----------

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio?: string | null;
  online?: boolean;
  lastSeenAt?: string | null;
}

export interface Attachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  size: number;
  mime: string;
  url: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string | null;
  clientId: string | null;
  body: string | null;
  kind: 'TEXT' | 'SYSTEM' | 'CALL';
  replyTo: { id: string; body: string | null; senderId: string | null } | null;
  attachments: Attachment[];
  reactions: { emoji: string; userIds: string[] }[];
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  type: 'DIRECT' | 'GROUP';
  name: string;
  avatarUrl: string | null;
  members: (PublicUser & { role: MemberRole })[];
  lastMessage: Message | null;
  unread: number;
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  myRole: MemberRole;
  adminsOnlyPost: boolean;
  /** For each member: newest message time they've received / read. Read times are hidden when they turned receipts off. */
  receipts: Record<string, { deliveredAt: string | null; readAt: string | null }>;
  updatedAt: string;
}

export interface CallRecord {
  id: string;
  type: CallType;
  status: CallStatus;
  conversationId: string;
  initiatorId: string;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  participants: PublicUser[];
}

export interface IceConfig {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  ttl: number;
}

// ---------- Socket.IO events ----------

export type SignalData =
  | { type: 'offer' | 'answer'; sdp: string }
  | { type: 'candidate'; candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } };

export type Ack<T = unknown> = (res: { ok: true; data?: T } | { ok: false; error: string }) => void;

export interface ClientToServer {
  'message:send': (input: z.input<typeof sendMessageInput>, ack: Ack<Message>) => void;
  'message:read': (input: { conversationId: string; messageId: string }) => void;
  'message:delivered': (input: { conversationId: string; messageId: string }) => void;
  'typing': (input: { conversationId: string; typing: boolean }) => void;
  'call:start': (input: { conversationId: string; type: CallType }, ack: Ack<{ callId: string; calleeIds: string[]; reachable: boolean; sfu: boolean }>) => void;
  'call:accept': (input: { callId: string }, ack: Ack<{ type: CallType; sfu: boolean; peers: string[] }>) => void;
  'call:reject': (input: { callId: string; reason?: 'declined' | 'busy' }) => void;
  'call:end': (input: { callId: string }) => void;
  'call:signal': (input: { callId: string; to: string; data: SignalData }) => void;
  'call:media': (input: { callId: string; audio: boolean; video: boolean }) => void;
  /** After a socket reconnect during a call: take the call over on this new connection. */
  'call:resume': (input: { callId: string }, ack: Ack<{ peers: string[] }>) => void;
  'presence:query': (input: { userIds: string[] }, ack: Ack<Record<string, { online: boolean; lastSeenAt: string | null }>>) => void;
}

export interface ServerToClient {
  'message:new': (m: Message) => void;
  'message:updated': (m: Message) => void;
  'receipt': (r: { conversationId: string; userId: string; deliveredAt?: string; readAt?: string }) => void;
  'typing': (t: { conversationId: string; userId: string; typing: boolean }) => void;
  'presence': (p: { userId: string; online: boolean; lastSeenAt: string | null }) => void;
  'conversation:updated': (c: { conversationId: string }) => void;
  'conversation:removed': (c: { conversationId: string }) => void;
  'notification': (n: { id: string; type: string; title: string; body: string; link: string | null }) => void;
  'call:incoming': (c: { callId: string; conversationId: string; type: CallType; from: PublicUser; group: boolean; groupName: string | null }) => void;
  'call:accepted': (c: { callId: string; userId: string }) => void;
  'call:rejected': (c: { callId: string; userId: string; reason: 'declined' | 'busy' }) => void;
  'call:ended': (c: { callId: string; status: CallStatus; by: string | null }) => void;
  'call:signal': (s: { callId: string; from: string; data: SignalData }) => void;
  'call:media': (c: { callId: string; userId: string; audio: boolean; video: boolean }) => void;
  /** A participant's connection came back; the other side should restart ICE. */
  'call:resumed': (c: { callId: string; userId: string }) => void;
  'call:left': (c: { callId: string; userId: string }) => void;
  'session:revoked': () => void;
}

export function kindOf(mime: string): AttachmentKind | null {
  return MIME_KINDS[mime] ?? null;
}
