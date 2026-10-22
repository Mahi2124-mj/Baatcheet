'use client';
import { useEffect, useRef, useState } from 'react';
import { Mic, Paperclip, Send, Smile, Square, X } from 'lucide-react';
import { LIMITS, kindOf } from '@baatcheet/shared';
import { errorText, uploadFile } from '@/lib/api';
import { bytes, cx } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import type { Message } from '@/lib/types';
import { IconButton, useToast } from '../ui';

const EMOJI = '😀 😁 😂 🤣 😊 😍 😘 😎 🤔 😴 😢 😭 😡 😮 🥳 🤗 🙏 👍 👎 👏 🙌 💪 👌 ✌️ 🤝 ❤️ 💔 🔥 ✨ 🎉 🎂 🌹 ☕ 🍕 🚆 ✈️ 🏏 ⚽ 🎵 📞 📷 💯 ✅ ❌ ⚠️ 🙈 🙏🏽 🪔 🌙 ☀️'.split(' ');

export interface Outgoing {
  body?: string;
  attachments?: { key: string; name: string; size: number; mime: string }[];
}

interface Props {
  conversationId: string;
  disabled?: string | null;
  replyTo: Message | null;
  replyName?: string;
  editing: Message | null;
  onCancel: () => void;
  onSend: (out: Outgoing) => void;
  onSaveEdit: (m: Message, body: string) => void;
}

interface Upload {
  id: string;
  name: string;
  size: number;
  progress: number;
  done?: { key: string; name: string; size: number; mime: string };
  error?: string;
}

export function Composer({ conversationId, disabled, replyTo, replyName, editing, onCancel, onSend, onSaveEdit }: Props) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [recording, setRecording] = useState<{ rec: MediaRecorder; started: number } | null>(null);
  const [recSecs, setRecSecs] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const typingSent = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editing) setText(editing.body ?? '');
    area.current?.focus();
  }, [editing, replyTo]);

  useEffect(() => {
    // Grow the box with its text, up to ~6 lines.
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecSecs(Math.round((Date.now() - recording.started) / 1000)), 500);
    return () => clearInterval(t);
  }, [recording]);

  const stopTyping = () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (typingSent.current) getSocket().emit('typing', { conversationId, typing: false });
    typingSent.current = 0;
  };
  useEffect(() => stopTyping, [conversationId]); // eslint-disable-line react-hooks/exhaustive-deps

  function onType(v: string) {
    setText(v);
    if (editing) return;
    const now = Date.now();
    if (v && now - typingSent.current > 3000) {
      getSocket().emit('typing', { conversationId, typing: true });
      typingSent.current = now;
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 4000);
  }

  async function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const mime = file.type || 'application/octet-stream';
      const kind = kindOf(mime);
      if (!kind) {
        toast(`“${file.name}”: this file type isn’t supported`, 'error');
        continue;
      }
      if (file.size > LIMITS.fileSize[kind]) {
        toast(`“${file.name}” is too large (max ${bytes(LIMITS.fileSize[kind])})`, 'error');
        continue;
      }
      const id = crypto.randomUUID();
      setUploads((u) => [...u, { id, name: file.name, size: file.size, progress: 0 }]);
      uploadFile(file, 'attachment', (p) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, progress: p } : x)))).then(
        (done) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, done, progress: 1 } : x))),
        (e) => setUploads((u) => u.map((x) => (x.id === id ? { ...x, error: errorText(e) } : x))),
      );
    }
  }

  const ready = uploads.filter((u) => u.done);
  const busy = uploads.some((u) => !u.done && !u.error);

  function submit() {
    const body = text.trim();
    if (editing) {
      if (body && body !== editing.body) onSaveEdit(editing, body);
      else onCancel();
      setText('');
      return;
    }
    if ((!body && !ready.length) || busy) return;
    onSend({ body: body || undefined, attachments: ready.map((u) => u.done!) });
    setText('');
    setUploads([]);
    setEmoji(false);
    stopTyping();
  }

  async function toggleRecord() {
    if (recording) {
      recording.rec.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(null);
        setRecSecs(0);
        const mime = (rec.mimeType || type || 'audio/webm').split(';')[0];
        const blob = new Blob(chunks, { type: mime });
        if (blob.size < 1000) return;
        const ext = mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm';
        void addFiles([new File([blob], `Voice message.${ext}`, { type: mime })]);
      };
      rec.start();
      setRecording({ rec, started: Date.now() });
    } catch {
      toast('Allow microphone access to record voice messages', 'error');
    }
  }

  if (disabled) {
    return <div className="safe-b border-t border-line bg-panel px-4 py-4 text-center text-sm text-muted">{disabled}</div>;
  }

  return (
    <div
      className="safe-b border-t border-line bg-panel"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
      }}
    >
      {(replyTo || editing) && (
        <div className="flex items-center gap-3 border-b border-line px-4 py-2">
          <div className="min-w-0 flex-1 border-l-4 border-accent pl-3">
            <p className="text-xs font-semibold text-accent">{editing ? 'Edit message' : `Reply to ${replyName ?? ''}`}</p>
            <p className="truncate text-sm text-muted">{(editing ?? replyTo)?.body ?? 'Attachment'}</p>
          </div>
          <IconButton label="Cancel" onClick={() => { onCancel(); setText(''); }}>
            <X className="size-5" />
          </IconButton>
        </div>
      )}
      {uploads.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-4 pt-3">
          {uploads.map((u) => (
            <div key={u.id} className={cx('relative w-40 shrink-0 rounded-xl border bg-panel-2 p-2 text-xs', u.error ? 'border-danger' : 'border-line')}>
              <p className="truncate font-medium">{u.name}</p>
              <p className="text-muted">{u.error ?? (u.done ? bytes(u.size) : `${Math.round(u.progress * 100)}%`)}</p>
              {!u.done && !u.error && <div className="mt-1 h-1 rounded bg-hover"><div className="h-1 rounded bg-accent" style={{ width: `${u.progress * 100}%` }} /></div>}
              <button aria-label={`Remove ${u.name}`} className="absolute right-1 top-1 text-muted" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}>
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {emoji && (
        <div className="grid grid-cols-10 gap-1 px-4 pt-3" role="listbox" aria-label="Emoji">
          {EMOJI.map((e) => (
            <button key={e} className="rounded-lg p-1 text-xl hover:bg-hover" onClick={() => { setText((t) => t + e); area.current?.focus(); }} aria-label={e}>
              {e}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1 px-2 py-2 sm:px-4">
        <IconButton label="Emoji" onClick={() => setEmoji((v) => !v)} active={emoji}>
          <Smile className="size-5" />
        </IconButton>
        {!editing && (
          <IconButton label="Attach files" onClick={() => fileInput.current?.click()}>
            <Paperclip className="size-5" />
          </IconButton>
        )}
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
        {recording ? (
          <div className="flex h-10 flex-1 items-center gap-2 rounded-2xl bg-panel-2 px-4 text-sm" role="status">
            <span className="size-2.5 animate-pulse rounded-full bg-danger" /> Recording… {recSecs}s
          </div>
        ) : (
          <textarea
            ref={area}
            rows={1}
            value={text}
            maxLength={LIMITS.messageLength}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && window.matchMedia('(pointer: fine)').matches) {
                e.preventDefault();
                submit();
              }
              if (e.key === 'Escape' && (editing || replyTo)) onCancel();
            }}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                void addFiles(e.clipboardData.files);
              }
            }}
            placeholder="Type a message"
            aria-label="Message"
            className="max-h-40 min-h-10 flex-1 resize-none rounded-2xl bg-panel-2 px-4 py-2.5 text-[15px] outline-none placeholder:text-muted"
          />
        )}
        {text.trim() || ready.length || editing ? (
          <IconButton label={editing ? 'Save' : 'Send'} onClick={submit} disabled={busy} className="bg-accent text-accent-ink hover:bg-accent hover:text-accent-ink">
            <Send className="size-5" />
          </IconButton>
        ) : (
          <IconButton label={recording ? 'Stop recording' : 'Record voice message'} onClick={toggleRecord} className={recording ? 'bg-danger text-white hover:bg-danger hover:text-white' : ''}>
            {recording ? <Square className="size-4" /> : <Mic className="size-5" />}
          </IconButton>
        )}
      </div>
    </div>
  );
}
