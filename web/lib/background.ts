'use client';
// "Run in background" (Settings, per device).
// On:  calls and messages reach this device while the app is in the background or closed — the live
//      connection stays open in a background tab, and Web Push covers a closed app.
// Off: nothing arrives until the app is opened again — push is switched off and the live connection is
//      dropped while the app is in the background (never during a call). Opening the app catches up.
import { calls } from './calls';
import { disablePush, enablePush, pushSupported } from './push';
import { pauseSocket, resumeSocket } from './socket';

const KEY = 'bc-background';
const listeners = new Set<() => void>();

export function backgroundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function subscribeBackground(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Switches the mode. Turning it on may fail to enable push (blocked / unsupported); that error is thrown. */
export async function setBackground(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // Storage blocked: lasts for this visit only.
  }
  listeners.forEach((l) => l());
  if (on) {
    if (document.visibilityState === 'visible') resumeSocket();
    if (pushSupported()) await enablePush();
  } else {
    await disablePush().catch(() => {});
  }
}

/** Drops / restores the live connection as the app goes to the background and back. Returns a cleanup. */
export function watchBackground(): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'visible') resumeSocket();
    else if (!backgroundEnabled()) {
      const phase = calls.getState().phase;
      if (phase === 'idle' || phase === 'ended') pauseSocket();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => document.removeEventListener('visibilitychange', onVisibility);
}
