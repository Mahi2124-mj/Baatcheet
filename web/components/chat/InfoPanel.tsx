'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { Archive, Bell, BellOff, Camera, Copy, Flag, Link2, LogOut, Pin, ShieldBan, Trash2, UserPlus, X } from 'lucide-react';
import { api, errorText, uploadFile } from '@/lib/api';
import { cx } from '@/lib/format';
import { useMe } from '@/lib/session';
import { clearThread, putConversations, removeConversation } from '@/lib/store';
import type { ConversationSummary, PublicUser } from '@/lib/types';
import { Avatar, Button, IconButton, Input, Modal, Select, useConfirm, useToast } from '../ui';

type Conv = ConversationSummary & { left?: boolean };

export function InfoPanel({ conv, onClose, onReportUser }: { conv: Conv; onClose: () => void; onReportUser: () => void }) {
  const me = useMe();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const [rename, setRename] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [invite, setInvite] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const group = conv.type === 'GROUP';
  const admin = group && conv.myRole !== 'MEMBER';
  const other = !group ? conv.members.find((m) => m.id !== me.id) : undefined;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const patchMe = (body: object) => run(async () => putConversations([await api.patch<ConversationSummary>(`/conversations/${conv.id}/me`, body)]));
  const patchGroup = (body: object) => run(async () => putConversations([await api.patch<ConversationSummary>(`/conversations/${conv.id}`, body)]));

  return (
    <aside className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-panel lg:static lg:z-auto lg:w-[340px] lg:border-l lg:border-line" aria-label="Chat details">
      <div className="safe-t flex items-center justify-between px-4 py-3">
        <h2 className="font-semibold">{group ? 'Group info' : 'Contact info'}</h2>
        <IconButton label="Close" onClick={onClose}>
          <X className="size-5" />
        </IconButton>
      </div>
      <div className="flex flex-col items-center gap-2 px-4 pb-4 text-center">
        <div className="relative">
          <Avatar name={conv.name} url={conv.avatarUrl} size={96} />
          {admin && (
            <button aria-label="Change group picture" onClick={() => avatarInput.current?.click()} className="absolute bottom-0 right-0 flex size-8 items-center justify-center rounded-full bg-accent text-accent-ink">
              <Camera className="size-4" />
            </button>
          )}
          <input
            ref={avatarInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void run(async () => patchGroup({ avatarKey: (await uploadFile(f, 'group-avatar')).key }));
            }}
          />
        </div>
        <p className="text-lg font-semibold">{conv.name}</p>
        {other && (
          <Link href={`/u/${other.username}`} className="text-sm text-accent">
            @{other.username}
          </Link>
        )}
        {group && admin && <button className="text-sm text-accent" onClick={() => setRename(conv.name)}>Rename group</button>}
      </div>

      <div className="space-y-1 border-t border-line px-2 py-2">
        <Row icon={conv.muted ? Bell : BellOff} label={conv.muted ? 'Unmute' : 'Mute notifications'} onClick={() => patchMe({ mutedForSeconds: conv.muted ? null : 8 * 3600 * 365 })} />
        <Row icon={Pin} label={conv.pinned ? 'Unpin chat' : 'Pin chat'} onClick={() => patchMe({ pinned: !conv.pinned })} />
        <Row icon={Archive} label={conv.archived ? 'Unarchive' : 'Archive chat'} onClick={() => patchMe({ archived: !conv.archived })} />
        <Row
          icon={Trash2}
          label="Clear chat for me"
          onClick={async () => {
            if (!(await confirm({ title: 'Clear this chat?', text: 'Messages disappear for you only.', confirm: 'Clear', danger: true }))) return;
            await run(async () => {
              await api.post(`/conversations/${conv.id}/clear`);
              clearThread(conv.id);
            }, 'Chat cleared');
          }}
        />
      </div>

      {group && (
        <div className="border-t border-line px-4 py-3">
          {admin && (
            <div className="mb-3 space-y-1">
              <Select
                label="Who can send messages"
                value={conv.adminsOnlyPost ? 'admins' : 'all'}
                onChange={(v) => patchGroup({ adminsOnlyPost: v === 'admins' })}
                options={[
                  { value: 'all', label: 'Everyone' },
                  { value: 'admins', label: 'Only admins' },
                ]}
              />
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                  <UserPlus className="size-4" /> Add people
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => run(async () => setInvite((await api.post<{ code: string }>(`/conversations/${conv.id}/invites`, {})).code))}
                >
                  <Link2 className="size-4" /> Invite link
                </Button>
              </div>
              {invite && (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-panel-2 p-2 text-xs">
                  <span className="truncate">{`${location.origin}/join/${invite}`}</span>
                  <IconButton label="Copy invite link" onClick={() => run(() => navigator.clipboard.writeText(`${location.origin}/join/${invite}`), 'Link copied')}>
                    <Copy className="size-4" />
                  </IconButton>
                </div>
              )}
            </div>
          )}
          <p className="mb-2 text-xs font-semibold uppercase text-muted">{conv.members.length} members</p>
          <ul>
            {conv.members.map((m) => (
              <li key={m.id} className="group flex items-center gap-3 rounded-lg px-1 py-1.5">
                <Avatar name={m.displayName} url={m.avatarUrl} size={36} online={m.online} />
                <Link href={`/u/${m.username}`} className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{m.id === me.id ? 'You' : m.displayName}</span>
                  <span className="block text-xs text-muted">{m.role === 'MEMBER' ? `@${m.username}` : m.role === 'OWNER' ? 'Owner' : 'Admin'}</span>
                </Link>
                {admin && m.id !== me.id && m.role !== 'OWNER' && (conv.myRole === 'OWNER' || m.role === 'MEMBER') && (
                  <span className="flex gap-1">
                    <button
                      className="text-xs text-accent"
                      onClick={() => run(() => api.patch(`/conversations/${conv.id}/members/${m.id}`, { role: m.role === 'ADMIN' ? 'MEMBER' : 'ADMIN' }))}
                    >
                      {m.role === 'ADMIN' ? 'Dismiss admin' : 'Make admin'}
                    </button>
                    <button
                      className="ml-2 text-xs text-danger"
                      onClick={async () => {
                        if (await confirm({ title: `Remove ${m.displayName}?`, confirm: 'Remove', danger: true })) await run(() => api.delete(`/conversations/${conv.id}/members/${m.id}`));
                      }}
                    >
                      Remove
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto space-y-1 border-t border-line px-2 py-2">
        {group && !conv.left && (
          <Row
            icon={LogOut}
            danger
            label="Leave group"
            onClick={async () => {
              if (!(await confirm({ title: 'Leave this group?', confirm: 'Leave', danger: true }))) return;
              await run(async () => {
                await api.delete(`/conversations/${conv.id}/members/${me.id}`);
                router.push('/chats');
              });
            }}
          />
        )}
        {group && conv.myRole === 'OWNER' && (
          <Row
            icon={Trash2}
            danger
            label="Delete group"
            onClick={async () => {
              if (!(await confirm({ title: 'Delete the group for everyone?', text: 'All messages and files will be deleted.', confirm: 'Delete', danger: true }))) return;
              await run(async () => {
                await api.delete(`/conversations/${conv.id}`);
                removeConversation(conv.id);
                router.push('/chats');
              });
            }}
          />
        )}
        {other && (
          <Row
            icon={ShieldBan}
            danger
            label={`Block ${other.displayName.split(' ')[0]}`}
            onClick={async () => {
              if (await confirm({ title: `Block ${other.displayName}?`, text: 'They won’t be able to message or call you, and won’t see your status.', confirm: 'Block', danger: true }))
                await run(() => api.post(`/users/${other.id}/block`), 'Blocked');
            }}
          />
        )}
        {other && <Row icon={Flag} danger label="Report" onClick={onReportUser} />}
      </div>

      <Modal open={rename !== null} onClose={() => setRename(null)} title="Rename group">
        <Input label="Group name" value={rename ?? ''} maxLength={80} onChange={(e) => setRename(e.target.value)} />
        <Button className="mt-4 w-full" disabled={!rename?.trim()} onClick={async () => { await patchGroup({ name: rename }); setRename(null); }}>
          Save
        </Button>
      </Modal>
      <AddMembers open={adding} conv={conv} onClose={() => setAdding(false)} />
    </aside>
  );
}

function Row({ icon: Icon, label, onClick, danger }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-hover', danger && 'text-danger')}>
      <Icon className="size-5" />
      {label}
    </button>
  );
}

function AddMembers({ open, conv, onClose }: { open: boolean; conv: Conv; onClose: () => void }) {
  const toast = useToast();
  const [contacts, setContacts] = useState<PublicUser[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  if (open && contacts === null) api.get<{ contacts: PublicUser[] }>('/contacts').then((r) => setContacts(r.contacts), () => setContacts([]));
  const available = (contacts ?? []).filter((c) => !conv.members.some((m) => m.id === c.id));
  return (
    <Modal open={open} onClose={onClose} title="Add people">
      {available.length === 0 && <p className="text-sm text-muted">All your contacts are already here. Use an invite link for others.</p>}
      <ul className="max-h-72 overflow-y-auto">
        {available.map((c) => (
          <li key={c.id}>
            <label className="flex items-center gap-3 rounded-lg p-2 hover:bg-hover">
              <input type="checkbox" checked={picked.includes(c.id)} onChange={() => setPicked((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))} />
              <Avatar name={c.displayName} url={c.avatarUrl} size={32} />
              <span className="text-sm">{c.displayName}</span>
            </label>
          </li>
        ))}
      </ul>
      <Button
        className="mt-3 w-full"
        disabled={!picked.length}
        onClick={async () => {
          try {
            const r = await api.post<{ added: string[]; skipped: string[] }>(`/conversations/${conv.id}/members`, { userIds: picked });
            toast(r.skipped.length ? `Added ${r.added.length}. ${r.skipped.length} need to add you as a contact first.` : `Added ${r.added.length}`, 'ok');
            setPicked([]);
            onClose();
          } catch (e) {
            toast(errorText(e), 'error');
          }
        }}
      >
        Add
      </Button>
    </Modal>
  );
}
