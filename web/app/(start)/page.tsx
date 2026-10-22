'use client';
// Start screen: just a picture. Pressing and holding it for 5 seconds opens Baatcheet; a tap or a
// short press does nothing, so the app isn't obvious to someone else picking up the phone.
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const HOLD_MS = 5000;
// Feedback only starts after a second, so an ordinary tap shows nothing at all.
const HINT_AFTER_MS = 1000;

export default function Start() {
  const router = useRouter();
  const [progress, setProgress] = useState(0);
  const started = useRef<number | null>(null);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    router.prefetch('/chats');
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [router]);

  function tick() {
    if (started.current === null) return;
    const held = performance.now() - started.current;
    setProgress(held < HINT_AFTER_MS ? 0 : Math.min(1, (held - HINT_AFTER_MS) / (HOLD_MS - HINT_AFTER_MS)));
    if (held >= HOLD_MS) {
      started.current = null;
      navigator.vibrate?.(30);
      router.replace('/chats');
      return;
    }
    frame.current = requestAnimationFrame(tick);
  }

  function start(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    started.current = performance.now();
    frame.current = requestAnimationFrame(tick);
  }

  function stop() {
    started.current = null;
    if (frame.current) cancelAnimationFrame(frame.current);
    setProgress(0);
  }

  const r = 20;
  const c = 2 * Math.PI * r;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg p-8">
      <div
        role="img"
        aria-label="Lake at sunset"
        className="relative w-full max-w-[280px] touch-none select-none"
        style={{ WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerCancel={stop}
        onPointerLeave={stop}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Picture />
        {progress > 0 && (
          <svg viewBox="0 0 48 48" className="pointer-events-none absolute bottom-3 right-3 size-7 -rotate-90 opacity-60" aria-hidden>
            <circle cx="24" cy="24" r={r} fill="none" stroke="white" strokeOpacity="0.35" strokeWidth="4" />
            <circle cx="24" cy="24" r={r} fill="none" stroke="white" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
          </svg>
        )}
      </div>
    </main>
  );
}

/** An ordinary landscape photo look-alike, drawn inline so the page needs nothing else. */
function Picture() {
  return (
    <svg viewBox="0 0 280 360" className="block w-full rounded-[22px] shadow-[0_10px_30px_rgba(0,0,0,0.18)]" aria-hidden>
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b4f8c" />
          <stop offset="0.45" stopColor="#c7718a" />
          <stop offset="0.75" stopColor="#f4a76b" />
          <stop offset="1" stopColor="#f9d38c" />
        </linearGradient>
        <linearGradient id="lake" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f2b27c" />
          <stop offset="0.35" stopColor="#a8678a" />
          <stop offset="1" stopColor="#2e3a66" />
        </linearGradient>
        <clipPath id="frame">
          <rect width="280" height="360" rx="22" />
        </clipPath>
      </defs>
      <g clipPath="url(#frame)">
        <rect width="280" height="230" fill="url(#sky)" />
        <circle cx="150" cy="172" r="24" fill="#fde3a7" opacity="0.95" />
        <path d="M0 196 L38 150 L66 176 L104 122 L146 186 L170 168 L206 132 L248 178 L280 160 L280 232 L0 232 Z" fill="#4a3b67" />
        <path d="M0 214 L52 182 L92 204 L130 176 L178 210 L224 186 L280 206 L280 232 L0 232 Z" fill="#2f2a4f" />
        <rect y="230" width="280" height="130" fill="url(#lake)" />
        <ellipse cx="150" cy="252" rx="20" ry="3" fill="#fde3a7" opacity="0.6" />
        <ellipse cx="150" cy="266" rx="34" ry="2.5" fill="#fde3a7" opacity="0.35" />
        <ellipse cx="150" cy="282" rx="48" ry="2" fill="#fde3a7" opacity="0.2" />
        <path d="M0 330 Q40 318 86 326 T180 324 T280 330 L280 360 L0 360 Z" fill="#1f2442" />
      </g>
    </svg>
  );
}
