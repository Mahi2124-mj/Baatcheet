'use client';
// Where call audio is heard: phone earpiece, loudspeaker, Bluetooth or wired headset.
//
// Browsers have no "speaker on/off" API, so two mechanisms are used, whichever the browser offers:
// - Chrome on Android lists the phone's audio routes as microphones ("Headset earpiece",
//   "Speakerphone", "Bluetooth headset", "Wired headset"). Choosing one of them as the microphone also
//   sends the call audio there, which is how we pick earpiece vs. speaker vs. Bluetooth.
// - Desktop browsers list real outputs (audiooutput). There the audio element's setSinkId() picks one.
// Safari on iPhone exposes neither: iOS decides (Bluetooth is used automatically when connected), and the
// user can change it from Control Center. The speaker button is hidden there.

export type AudioRoute = 'earpiece' | 'speaker' | 'bluetooth' | 'wired';

export interface RouteOption {
  route: AudioRoute;
  label: string;
  /** Microphone deviceId that selects this route (Chrome on Android), if any. */
  inputId?: string;
  /** Output deviceId for setSinkId (desktop browsers), if any. */
  outputId?: string;
}

const RE = {
  bluetooth: /bluetooth|\bbt\b|airpods|buds|hands-?free|\bhfp\b|\bsco\b/i,
  earpiece: /earpiece|handset|receiver/i,
  // Not plain "USB": a webcam microphone is not a headset.
  wired: /wired|headphone|headset|earphone|3\.5|jack/i,
  speaker: /speaker|loudspeaker/i,
};

export function classify(label: string): AudioRoute | null {
  if (!label) return null;
  if (RE.bluetooth.test(label)) return 'bluetooth';
  // "Headset earpiece" on Android is the phone's own earpiece, so check it before "headset".
  if (RE.earpiece.test(label)) return 'earpiece';
  if (RE.speaker.test(label)) return 'speaker';
  if (RE.wired.test(label)) return 'wired';
  return null;
}

const NAMES: Record<AudioRoute, string> = { earpiece: 'Phone', speaker: 'Speaker', bluetooth: 'Bluetooth', wired: 'Headphones' };

export const sinkSupported = () => typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/** The audio routes this device offers right now (needs microphone permission for labels). */
export async function listRoutes(): Promise<RouteOption[]> {
  let devices: MediaDeviceInfo[] = [];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return [];
  }
  const byRoute = new Map<AudioRoute, RouteOption>();
  const put = (d: MediaDeviceInfo, field: 'inputId' | 'outputId') => {
    if (d.deviceId === 'default' || d.deviceId === 'communications' || !d.deviceId) return;
    const route = classify(d.label);
    if (!route) return;
    const o = byRoute.get(route) ?? { route, label: route === 'bluetooth' || route === 'wired' ? cleanLabel(d.label, route) : NAMES[route] };
    if (!o[field]) o[field] = d.deviceId;
    byRoute.set(route, o);
  };
  devices.filter((d) => d.kind === 'audioinput').forEach((d) => put(d, 'inputId'));
  if (sinkSupported()) devices.filter((d) => d.kind === 'audiooutput').forEach((d) => put(d, 'outputId'));
  // Only routes we can actually switch to are useful.
  const order: AudioRoute[] = ['earpiece', 'speaker', 'bluetooth', 'wired'];
  return order.map((r) => byRoute.get(r)).filter((o): o is RouteOption => Boolean(o && (o.inputId || o.outputId)));
}

function cleanLabel(label: string, route: AudioRoute) {
  const l = label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  return l.length > 28 || !l ? NAMES[route] : l;
}

/** The route a call should start on: a connected headset first, else earpiece for voice, speaker for video. */
export function defaultRoute(options: RouteOption[], video: boolean): RouteOption | null {
  const pick = (r: AudioRoute) => options.find((o) => o.route === r);
  return pick('bluetooth') ?? pick('wired') ?? (video ? pick('speaker') : pick('earpiece') ?? pick('speaker')) ?? null;
}

export function routeName(r: AudioRoute) {
  return NAMES[r];
}
