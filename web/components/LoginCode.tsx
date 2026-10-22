'use client';
import { useEffect, useState } from 'react';
import { Copy, Eye, EyeOff, KeyRound, RefreshCw } from 'lucide-react';
import { api, errorText } from '@/lib/api';
import { Button, Spinner, useConfirm, useToast } from '@/components/ui';

/** Shows the user's personal login code with copy / show / new-code controls. */
export function LoginCodeBox({ compact }: { compact?: boolean }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [code, setCode] = useState<string | null>(null);
  const [shown, setShown] = useState(Boolean(compact));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ code: string }>('/auth/login-code').then((r) => setCode(r.code), (e) => toast(errorText(e), 'error'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      toast('Login code copied', 'ok');
    } catch {
      toast('Couldn’t copy — select the code and copy it by hand', 'error');
    }
  }

  async function regenerate() {
    const ok = await confirm({
      title: 'Make a new login code?',
      text: 'Your current code stops working. Devices that are already logged in stay logged in.',
      confirm: 'New code',
    });
    if (!ok) return;
    setBusy(true);
    try {
      setCode((await api.post<{ code: string }>('/auth/login-code/regenerate')).code);
      setShown(true);
      toast('New login code ready', 'ok');
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-panel-2 p-3">
        <KeyRound className="size-5 shrink-0 text-accent" />
        <span className="min-w-0 flex-1 select-all break-all font-mono text-lg tracking-widest" aria-label="Your login code">
          {code ? (shown ? code : '••••-••••-••••') : <Spinner className="size-4" />}
        </span>
        {!compact && (
          <button className="p-1 text-muted hover:text-text" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide code' : 'Show code'}>
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        )}
        <button className="p-1 text-muted hover:text-text" onClick={copy} aria-label="Copy code" disabled={!code}>
          <Copy className="size-4" />
        </button>
      </div>
      <p className="text-xs text-muted">
        On any phone or computer, choose <b>Log in with code</b> and type this code — no e-mail or password needed. Keep it secret: anyone with it can open your account.
      </p>
      {!compact && (
        <Button variant="secondary" size="sm" loading={busy} onClick={regenerate}>
          <RefreshCw className="size-4" /> Make a new code
        </Button>
      )}
    </div>
  );
}
