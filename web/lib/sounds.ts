'use client';
// Short alert sounds for new messages while the app is open (made with Web Audio, no files to load).
let ctx: AudioContext | null = null;

function audio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/**
 * 'chat': a soft pop for a message in the chat you have open; 'other': a two-note chime for another chat.
 * Phones that allow it also give a short buzz.
 */
export function messageAlert(kind: 'chat' | 'other') {
  navigator.vibrate?.(kind === 'chat' ? 25 : [40, 60, 40]);
  const c = audio();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  const notes = kind === 'chat' ? [[880, 0]] : [[784, 0], [1047, 0.12]];
  for (const [freq, at] of notes) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, now + at);
    if (kind === 'chat') o.frequency.exponentialRampToValueAtTime(freq * 1.5, now + at + 0.08);
    g.gain.setValueAtTime(0.0001, now + at);
    g.gain.exponentialRampToValueAtTime(kind === 'chat' ? 0.08 : 0.1, now + at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + at + (kind === 'chat' ? 0.14 : 0.25));
    o.connect(g).connect(c.destination);
    o.start(now + at);
    o.stop(now + at + 0.3);
  }
}

/** Browsers only allow sound after a tap: call this from any tap so later alerts can play. */
export function unlockAudio() {
  audio();
}
