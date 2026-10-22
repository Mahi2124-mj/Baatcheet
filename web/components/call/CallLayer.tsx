'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Bluetooth, Check, Ear, Headphones, Maximize, MicOff, Mic, Minimize2, Phone, PhoneOff, PictureInPicture2, SwitchCamera, Video, VideoOff, Volume2 } from 'lucide-react';
import type { AudioRoute } from '@/lib/audioRoute';
import { calls, type CallState, type GroupTile } from '@/lib/calls';
import { cx, duration } from '@/lib/format';
import { Avatar, useToast } from '../ui';

function useCall(): CallState {
  return useSyncExternalStore(calls.subscribe, calls.getState, calls.getState);
}

function useTimer(from: number | null) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!from) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [from]);
  return from ? Math.max(0, Math.floor((Date.now() - from) / 1000)) : 0;
}

function MediaView({ stream, muted, mirror, className, videoRef, audioOnly }: { stream: MediaStream | null; muted?: boolean; mirror?: boolean; className?: string; videoRef?: React.RefObject<HTMLVideoElement | null>; audioOnly?: boolean }) {
  const own = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? own;
  const audio = useRef<HTMLAudioElement>(null);
  const sinkId = useSyncExternalStore(calls.subscribe, () => calls.getState().sinkId, () => null);
  useEffect(() => {
    const el = audioOnly ? audio.current : ref.current;
    if (el && el.srcObject !== stream) {
      el.srcObject = stream;
      el.play?.().catch(() => {});
    }
  }, [stream, ref, audioOnly]);
  // Desktop browsers: play the call on the chosen output (speakers, headset, Bluetooth).
  useEffect(() => {
    const el = (audioOnly ? audio.current : ref.current) as (HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    // Leave the element alone until a route is chosen (Android routes through the microphone instead).
    if (!el?.setSinkId || muted || (!sinkId && !(el as { sinkId?: string }).sinkId)) return;
    el.setSinkId(sinkId ?? '').catch(() => {});
  }, [sinkId, audioOnly, ref, muted]);
  if (audioOnly) return <audio ref={audio} autoPlay />;
  return <video ref={ref} autoPlay playsInline muted={muted} className={cx('bg-black object-cover', mirror && '-scale-x-100', className)} />;
}

function Ctrl({ label, onClick, children, danger, off, big }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean; off?: boolean; big?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        'flex items-center justify-center rounded-full transition active:scale-95',
        // Smaller on narrow phones so all five buttons fit in one row.
        big ? 'size-14 sm:size-16' : 'size-12 sm:size-14',
        danger ? 'bg-danger text-white' : off ? 'bg-white text-black' : 'bg-white/15 text-white hover:bg-white/25',
      )}
    >
      {children}
    </button>
  );
}

function statusText(s: CallState, secs: number) {
  switch (s.phase) {
    case 'outgoing':
      return s.callId ? (s.reachable ? 'Ringing…' : 'Calling… (they’re offline; we sent a notification)') : 'Starting…';
    case 'connecting':
      return 'Connecting…';
    case 'reconnecting':
      return 'Reconnecting… check your internet';
    case 'connected':
      return duration(secs);
    case 'ended':
      return s.endReason ?? 'Call ended';
    default:
      return '';
  }
}

function Tile({ t }: { t: GroupTile }) {
  return (
    <div className={cx('relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-white/5', t.speaking && 'ring-2 ring-accent')}>
      {t.video && t.stream ? <MediaView stream={t.stream} muted={t.local} mirror={t.local} className="size-full" /> : <Avatar name={t.name} size={72} />}
      {!t.local && t.stream && !t.video && <MediaView stream={t.stream} audioOnly />}
      <span className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-xs text-white">
        {!t.audio && <MicOff className="size-3" />}
        {t.local ? 'You' : t.name}
      </span>
    </div>
  );
}

const ROUTE_ICON: Record<AudioRoute, React.ComponentType<{ className?: string }>> = { earpiece: Ear, speaker: Volume2, bluetooth: Bluetooth, wired: Headphones };

/**
 * Speaker button. With only earpiece + speaker it toggles; with a Bluetooth / wired headset as well it
 * opens a small menu. Hidden when the browser can't switch (iPhone: use Control Center instead).
 */
function AudioRouteButton({ s }: { s: CallState }) {
  const [open, setOpen] = useState(false);
  const routes = s.audioRoutes;
  if (routes.length < 2 || !routes.some((r) => r.route === 'speaker')) return null;
  const speakerOn = s.audioRoute === 'speaker';
  const menu = routes.some((r) => r.route === 'bluetooth' || r.route === 'wired');
  const Icon = s.audioRoute && s.audioRoute !== 'earpiece' ? ROUTE_ICON[s.audioRoute] : Volume2;
  return (
    <div className="relative">
      <Ctrl
        label={menu ? 'Choose audio output' : speakerOn ? 'Turn speaker off' : 'Turn speaker on'}
        off={speakerOn}
        onClick={() => (menu ? setOpen(!open) : void calls.toggleSpeaker())}
      >
        <Icon className="size-6" />
      </Ctrl>
      {menu && open && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" aria-label="Close menu" onClick={() => setOpen(false)} />
          <ul role="menu" className="absolute bottom-16 left-1/2 z-20 w-56 -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-[#1a1f27] py-1 shadow-2xl">
            {routes.map((r) => {
              const I = ROUTE_ICON[r.route];
              return (
                <li key={r.route}>
                  <button
                    role="menuitemradio"
                    aria-checked={s.audioRoute === r.route}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-white/10"
                    onClick={() => {
                      setOpen(false);
                      void calls.setAudioRoute(r.route);
                    }}
                  >
                    <I className="size-5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{r.label}</span>
                    {s.audioRoute === r.route && <Check className="size-4 text-ok" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export function CallLayer() {
  const s = useCall();
  const toast = useToast();
  const secs = useTimer(s.connectedAt);
  const [mini, setMini] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (s.phase === 'idle') setMini(false);
  }, [s.phase]);

  // Keep the screen title useful while in a call.
  useEffect(() => {
    if (s.phase === 'incoming') document.title = `📞 ${s.title} is calling…`;
    else if (s.phase === 'connected') document.title = `📞 ${duration(secs)} · ${s.title}`;
    else document.title = 'Baatcheet';
  }, [s.phase, s.title, secs]);

  if (s.phase === 'idle') return null;

  if (s.phase === 'incoming') {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" role="alertdialog" aria-label={`Incoming call from ${s.title}`}>
        <div className="w-full max-w-sm rounded-3xl border border-line bg-panel p-6 text-center shadow-2xl">
          <div className="relative mx-auto mb-4 w-fit ring-pulse rounded-full">
            <Avatar name={s.title} url={s.group ? null : s.peer?.avatarUrl} size={96} />
          </div>
          <p className="text-xl font-semibold">{s.title}</p>
          <p className="mt-1 text-sm text-muted">
            {s.group && s.peer ? `${s.peer.displayName} · ` : ''}Incoming {s.type === 'VIDEO' ? 'video' : 'voice'} call…
          </p>
          <div className="mt-8 flex justify-center gap-10">
            <div className="flex flex-col items-center gap-2">
              <Ctrl label="Decline" danger big onClick={() => calls.decline()}>
                <PhoneOff className="size-7" />
              </Ctrl>
              <span className="text-xs text-muted">Decline</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <button aria-label="Accept" onClick={() => void calls.accept()} className="flex size-16 items-center justify-center rounded-full bg-ok text-white active:scale-95">
                {s.type === 'VIDEO' ? <Video className="size-7" /> : <Phone className="size-7" />}
              </button>
              <span className="text-xs text-muted">Accept</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const video = s.type === 'VIDEO';
  const remoteHasVideo = Boolean(s.remote?.getVideoTracks().length) && s.remoteMedia.video;
  const status = statusText(s, secs);

  if (mini && s.phase !== 'ended') {
    return (
      <button
        onClick={() => setMini(false)}
        className="safe-t fixed left-1/2 top-2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-full bg-ok px-4 py-2 text-sm font-medium text-white shadow-xl"
        aria-label="Return to call"
      >
        <Phone className="size-4" /> {s.title} · {status}
        {!s.group && <MediaView stream={s.remote} audioOnly />}
      </button>
    );
  }

  return (
    <div ref={stage} className="fixed inset-0 z-[60] flex flex-col bg-[#07090d] text-white" role="dialog" aria-label={`Call with ${s.title}`}>
      <div className="safe-t flex items-center justify-between px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{s.title}</p>
          <p className="text-xs text-white/70" aria-live="polite">
            {status}
            {s.audioOnlyFallback && video ? ' · your camera is off (no access)' : ''}
          </p>
        </div>
        <div className="flex gap-1">
          {video && !s.group && remoteHasVideo && typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && (
            <button aria-label="Picture in picture" className="rounded-full p-2 hover:bg-white/10" onClick={() => void remoteVideo.current?.requestPictureInPicture?.().catch(() => {})}>
              <PictureInPicture2 className="size-5" />
            </button>
          )}
          {video && (
            <button
              aria-label="Full screen"
              className="rounded-full p-2 hover:bg-white/10"
              onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void stage.current?.requestFullscreen?.().catch(() => {}))}
            >
              <Maximize className="size-5" />
            </button>
          )}
          <button aria-label="Minimise call" className="rounded-full p-2 hover:bg-white/10" onClick={() => setMini(true)}>
            <Minimize2 className="size-5" />
          </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {s.group ? (
          <div className={cx('grid h-full content-center gap-3 overflow-y-auto p-3', s.tiles.length <= 1 ? 'grid-cols-1' : s.tiles.length <= 4 ? 'grid-cols-2' : 'grid-cols-2 md:grid-cols-3')}>
            {s.tiles.length === 0 && <p className="text-center text-white/70">Joining…</p>}
            {s.tiles.map((t) => (
              <Tile key={t.id} t={t} />
            ))}
          </div>
        ) : video ? (
          <>
            {remoteHasVideo ? (
              <MediaView stream={s.remote} videoRef={remoteVideo} className="size-full object-contain" />
            ) : (
              <div className="flex size-full flex-col items-center justify-center gap-4">
                <Avatar name={s.title} url={s.peer?.avatarUrl} size={120} />
                {s.phase === 'connected' && <p className="text-sm text-white/70">{s.remoteMedia.video ? 'Waiting for video…' : 'Camera is off'}</p>}
                <MediaView stream={s.remote} audioOnly />
              </div>
            )}
            {s.local && s.camOn && (
              <MediaView stream={s.local} muted mirror className="absolute bottom-4 right-4 aspect-[3/4] w-28 rounded-2xl border border-white/20 shadow-xl sm:w-40" />
            )}
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-5">
            <div className={cx('relative rounded-full', s.phase === 'outgoing' && 'ring-pulse')}>
              <Avatar name={s.title} url={s.peer?.avatarUrl} size={140} />
            </div>
            <p className="text-2xl font-semibold">{s.title}</p>
            <p className="text-white/70">{status}</p>
            {!s.remoteMedia.audio && s.phase === 'connected' && (
              <p className="flex items-center gap-2 text-sm text-white/70">
                <MicOff className="size-4" /> {s.title.split(' ')[0]} is muted
              </p>
            )}
            <MediaView stream={s.remote} audioOnly />
          </div>
        )}
        {s.phase === 'ended' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60">
            <p className="text-lg font-semibold">{s.endReason}</p>
          </div>
        )}
        {s.error && s.phase === 'ended' && <p className="absolute inset-x-0 bottom-6 text-center text-sm text-red-300">{s.error}</p>}
      </div>

      <div className="safe-b flex items-center justify-center gap-3 px-4 py-6 sm:gap-4">
        <Ctrl label={s.micOn ? 'Mute microphone' : 'Unmute microphone'} off={!s.micOn} onClick={() => calls.toggleMic()}>
          {s.micOn ? <Mic className="size-6" /> : <MicOff className="size-6" />}
        </Ctrl>
        {/* Voice call: turns it into a video call. Video call: camera on / off. */}
        <Ctrl
          label={!video || s.audioOnlyFallback ? 'Turn on video' : s.camOn ? 'Turn camera off' : 'Turn camera on'}
          off={video && !s.audioOnlyFallback && !s.camOn}
          onClick={() => void calls.toggleCam().catch((e: Error) => toast(e.message, 'error'))}
        >
          {s.camOn || !video || s.audioOnlyFallback ? <Video className="size-6" /> : <VideoOff className="size-6" />}
        </Ctrl>
        <AudioRouteButton s={s} />
        {video && s.canSwitchCamera && s.camOn && (
          <Ctrl label="Switch camera" onClick={() => void calls.switchCamera()}>
            <SwitchCamera className="size-6" />
          </Ctrl>
        )}
        <Ctrl label="End call" danger big onClick={() => calls.hangUp()}>
          <PhoneOff className="size-7" />
        </Ctrl>
      </div>
    </div>
  );
}
