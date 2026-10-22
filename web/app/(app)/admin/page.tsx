'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { cx, timeShort } from '@/lib/format';
import { useMe } from '@/lib/session';
import { Button, Card, Empty, ErrorBox, Skeleton, useToast } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';

type Tab = 'overview' | 'reports' | 'users' | 'groups' | 'audit';

interface Stats {
  users: number; verified: number; suspended: number; newUsers30d: number; online: number;
  conversations: number; groups: number; messages: number; messages24h: number;
  calls: number; calls24h: number; activeCalls: number; openReports: number;
  calls30d: { status: string; type: string; count: number }[];
  messagesPerDay: { day: string; count: number }[];
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-panel-2 p-4">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

export default function AdminPage() {
  const me = useMe();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<unknown>(null);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [reportStatus, setReportStatus] = useState('OPEN');

  const load = useCallback(async () => {
    setError(null);
    setData(null);
    try {
      if (tab === 'overview') {
        setData(await api.get<Stats>('/admin/stats'));
        setHealth(await api.get('/admin/health'));
      } else if (tab === 'reports') setData(await api.get(`/admin/reports?status=${reportStatus}`));
      else if (tab === 'users') setData(await api.get(`/admin/users?q=${encodeURIComponent(q)}`));
      else if (tab === 'groups') setData(await api.get(`/admin/groups?q=${encodeURIComponent(q)}`));
      else setData(await api.get('/admin/audit'));
    } catch (e) {
      setError(errorText(e));
    }
  }, [tab, q, reportStatus]);
  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok, 'ok');
      await load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const askReason = (what: string) => window.prompt(`Reason to ${what} (saved in the audit log):`)?.trim();

  if (me.role !== 'ADMIN') return <ErrorBox text="Admins only." />;

  return (
    <div className="h-full overflow-y-auto">
      <PageHeader title="Admin" />
      <div className="mx-auto max-w-5xl p-4">
        <div className="mb-4 flex gap-2 overflow-x-auto" role="tablist">
          {(['overview', 'reports', 'users', 'groups', 'audit'] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setQ(''); }} className={cx('rounded-full px-4 py-1.5 text-sm capitalize', tab === t ? 'bg-accent text-accent-ink' : 'bg-panel-2 text-muted')}>
              {t}
            </button>
          ))}
        </div>
        <p className="mb-4 text-xs text-muted">Admins see account data, call/message counts and reported content only — never private chats, passwords, tokens or call media. Every action is written to the audit log.</p>
        {(tab === 'users' || tab === 'groups') && (
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${tab}`} aria-label={`Search ${tab}`} className="mb-4 h-10 w-full rounded-xl bg-panel-2 px-3 text-sm outline-none" />
        )}
        {tab === 'reports' && (
          <select aria-label="Report status" value={reportStatus} onChange={(e) => setReportStatus(e.target.value)} className="mb-4 h-9 rounded-lg border border-line bg-panel-2 px-2 text-sm">
            {['OPEN', 'REVIEWING', 'ACTIONED', 'DISMISSED', 'all'].map((s) => <option key={s}>{s}</option>)}
          </select>
        )}
        {error && <ErrorBox text={error} retry={load} />}
        {!data && !error && <Skeleton className="h-64" />}

        {tab === 'overview' && data ? (() => {
          const s = data as Stats;
          const max = Math.max(1, ...s.messagesPerDay.map((d) => d.count));
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Users" value={s.users} />
                <Stat label="Online now" value={s.online} />
                <Stat label="New (30 days)" value={s.newUsers30d} />
                <Stat label="Open reports" value={s.openReports} />
                <Stat label="Messages (24 h)" value={s.messages24h} />
                <Stat label="Calls (24 h)" value={s.calls24h} />
                <Stat label="Calls right now" value={s.activeCalls} />
                <Stat label="Groups" value={s.groups} />
              </div>
              <Card title="Messages per day (14 days)">
                <div className="flex h-32 items-end gap-1">
                  {s.messagesPerDay.map((d) => (
                    <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.count}`}>
                      <div className="w-full rounded-t bg-accent" style={{ height: `${(d.count / max) * 100}%` }} />
                    </div>
                  ))}
                  {s.messagesPerDay.length === 0 && <p className="text-sm text-muted">No messages yet.</p>}
                </div>
              </Card>
              <Card title="Calls by result (30 days)">
                <ul className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
                  {s.calls30d.map((c) => <li key={c.status + c.type}>{c.type.toLowerCase()} · {c.status.toLowerCase()}: <strong>{c.count}</strong></li>)}
                  {s.calls30d.length === 0 && <li className="text-muted">No calls yet.</li>}
                </ul>
              </Card>
              {health && (
                <Card title="System health">
                  <p className="text-sm">Database {String((health.db as { ok: boolean }).ok ? 'OK' : 'DOWN')} ({(health.db as { ms: number }).ms} ms) · uptime {Math.round(Number(health.uptimeSec) / 60)} min · memory {String(health.rssMb)} MB · {String(health.node)}</p>
                </Card>
              )}
            </div>
          );
        })() : null}

        {tab === 'reports' && Array.isArray(data) && (
          <ul className="space-y-3">
            {data.length === 0 && <Empty title="No reports" />}
            {(data as { id: string; reason: string; details: string | null; evidence: string | null; status: string; createdAt: string; reporter: { username: string } | null; reported: { id: string; username: string; suspended: boolean } | null }[]).map((r) => (
              <li key={r.id} className="rounded-2xl border border-line bg-panel p-4 text-sm">
                <p className="font-semibold">{r.reason} · <span className="text-muted">{r.status.toLowerCase()} · {timeShort(r.createdAt)}</span></p>
                <p className="mt-1">Reported: <strong>@{r.reported?.username ?? 'deleted'}</strong>{r.reported?.suspended && ' (suspended)'} · by @{r.reporter?.username ?? 'deleted'}</p>
                {r.evidence && <blockquote className="mt-2 rounded-lg bg-panel-2 p-2 italic">“{r.evidence}”</blockquote>}
                {r.details && <p className="mt-2 text-muted">{r.details}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.reported && !r.reported.suspended && (
                    <Button size="sm" variant="danger" onClick={() => { const reason = askReason('suspend'); if (reason) void act(async () => { await api.post(`/admin/users/${r.reported!.id}/suspend`, { reason }); await api.patch(`/admin/reports/${r.id}`, { status: 'ACTIONED', resolution: `suspended: ${reason}` }); }, 'User suspended'); }}>
                      Suspend user
                    </Button>
                  )}
                  {r.status === 'OPEN' && <Button size="sm" variant="secondary" onClick={() => act(() => api.patch(`/admin/reports/${r.id}`, { status: 'REVIEWING' }), 'Marked as reviewing')}>Reviewing</Button>}
                  {['OPEN', 'REVIEWING'].includes(r.status) && <Button size="sm" variant="ghost" onClick={() => act(() => api.patch(`/admin/reports/${r.id}`, { status: 'DISMISSED' }), 'Dismissed')}>Dismiss</Button>}
                </div>
              </li>
            ))}
          </ul>
        )}

        {tab === 'users' && data ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-muted"><tr><th className="p-2">User</th><th className="p-2">E-mail</th><th className="p-2">Joined</th><th className="p-2">Msgs</th><th className="p-2">Reports</th><th className="p-2" /></tr></thead>
              <tbody>
                {(data as { items: { id: string; username: string; displayName: string; email: string | null; emailVerified: boolean; role: string; createdAt: string; messages: number; reports: number; suspendedAt: string | null }[] }).items.map((u) => (
                  <tr key={u.id} className="border-t border-line">
                    <td className="p-2">{u.displayName} <span className="text-muted">@{u.username}</span> {u.role === 'ADMIN' && <span className="text-accent">admin</span>}</td>
                    <td className="p-2">{u.email ?? <span className="text-muted">—</span>}{u.email && !u.emailVerified && <span className="text-muted"> (unverified)</span>}</td>
                    <td className="p-2">{timeShort(u.createdAt)}</td>
                    <td className="p-2">{u.messages}</td>
                    <td className="p-2">{u.reports}</td>
                    <td className="p-2 text-right">
                      {u.id === me.id ? null : u.suspendedAt ? (
                        <Button size="sm" variant="secondary" onClick={() => act(() => api.post(`/admin/users/${u.id}/restore`), 'Restored')}>Restore</Button>
                      ) : u.role !== 'ADMIN' ? (
                        <Button size="sm" variant="danger" onClick={() => { const reason = askReason('suspend'); if (reason) void act(() => api.post(`/admin/users/${u.id}/suspend`, { reason }), 'Suspended'); }}>Suspend</Button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {tab === 'groups' && Array.isArray(data) && (
          <ul className="divide-y divide-line">
            {data.length === 0 && <Empty title="No groups" />}
            {(data as { id: string; name: string; members: number; messages: number; lastMessageAt: string }[]).map((g) => (
              <li key={g.id} className="flex items-center gap-3 py-3 text-sm">
                <span className="flex-1"><strong>{g.name}</strong> <span className="text-muted">· {g.members} members · {g.messages} messages · active {timeShort(g.lastMessageAt)}</span></span>
                <Button size="sm" variant="danger" onClick={() => { const reason = askReason('delete this group'); if (reason) void act(() => api.delete(`/admin/groups/${g.id}`, { reason }), 'Group deleted'); }}>Delete</Button>
              </li>
            ))}
          </ul>
        )}

        {tab === 'audit' && Array.isArray(data) && (
          <ul className="divide-y divide-line text-sm">
            {data.length === 0 && <Empty title="Nothing logged yet" />}
            {(data as { id: string; action: string; actor: string | null; targetType: string | null; targetId: string | null; createdAt: string; meta: unknown }[]).map((a) => (
              <li key={a.id} className="py-2">
                <span className="text-muted">{timeShort(a.createdAt)}</span> · <strong>{a.action}</strong> by @{a.actor ?? 'system'} → {a.targetType} {a.targetId?.slice(0, 10)} {a.meta ? <span className="text-muted">{JSON.stringify(a.meta)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
