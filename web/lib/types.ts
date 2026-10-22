export type { Attachment, CallRecord, CallType, ConversationSummary, Message, PublicUser, MemberRole } from '@baatcheet/shared';

export interface Me {
  id: string;
  email: string | null;
  emailVerified: boolean;
  role: 'USER' | 'ADMIN';
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  onboarded: boolean;
  settings: {
    lastSeenVisibility: 'EVERYONE' | 'CONTACTS' | 'NOBODY';
    profileVisibility: 'EVERYONE' | 'CONTACTS' | 'NOBODY';
    allowMessagesFrom: 'EVERYONE' | 'CONTACTS';
    readReceipts: boolean;
    notifyMessages: boolean;
    notifyCalls: boolean;
    notifyGroups: boolean;
  };
  createdAt: string;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt?: string | null;
  createdAt?: string;
}
