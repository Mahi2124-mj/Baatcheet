'use client';
import { useState } from 'react';
import { api, errorText } from '@/lib/api';
import type { Message } from '@/lib/types';
import { Button, Modal, useToast } from '../ui';

const REASONS = [
  ['SPAM', 'Spam'],
  ['HARASSMENT', 'Harassment or bullying'],
  ['HATE', 'Hate speech'],
  ['VIOLENCE', 'Violence or threats'],
  ['NUDITY', 'Nudity or sexual content'],
  ['SCAM', 'Scam or fraud'],
  ['OTHER', 'Something else'],
] as const;

/** Report a message (target.id set) or a user (target.id empty, target.senderId = user). */
export function ReportDialog({ target, conversationId, onClose }: { target: Pick<Message, 'id' | 'senderId'> | null; conversationId?: string; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>('SPAM');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    if (!target) return;
    setBusy(true);
    try {
      await api.post('/reports', target.id ? { messageId: target.id, reason, details: details || undefined } : { userId: target.senderId, conversationId, reason, details: details || undefined });
      toast('Thanks — our moderators will review it.', 'ok');
      onClose();
      setDetails('');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={Boolean(target)} onClose={onClose} title={target?.id ? 'Report message' : 'Report user'}>
      <p className="mb-3 text-sm text-muted">{target?.id ? 'A copy of this message is sent to moderators with your report.' : 'Moderators see account details and what you write here. They can’t read your chats.'}</p>
      <fieldset className="space-y-1">
        <legend className="sr-only">Reason</legend>
        {REASONS.map(([v, label]) => (
          <label key={v} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover">
            <input type="radio" name="reason" checked={reason === v} onChange={() => setReason(v)} className="accent-[var(--accent)]" />
            <span className="text-sm">{label}</span>
          </label>
        ))}
      </fieldset>
      <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={1000} placeholder="Anything else? (optional)" aria-label="Details" className="mt-3 h-20 w-full resize-none rounded-xl border border-line bg-panel-2 p-3 text-sm outline-none" />
      <Button className="mt-3 w-full" variant="danger" loading={busy} onClick={submit}>
        Send report
      </Button>
    </Modal>
  );
}
