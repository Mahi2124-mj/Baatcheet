'use client';
// Voice / video calls in the browser.
// 1:1 calls: RTCPeerConnection between the two browsers; offers, answers and ICE candidates go
// through the authenticated Socket.IO connection. Only the caller ever sends offers (also for ICE
// restarts), so the two sides can't both offer at once.
// Group calls: LiveKit (SFU). The server rings members and hands out a room token.
import type { CallType, IceConfig, PublicUser, SignalData } from '@baatcheet/shared';
import type { Room } from 'livekit-client';
import { api } from './api';
import { closeNotification, localNotify } from './push';
import { sharedAudio } from './sounds';
import { defaultRoute, listRoutes, type AudioRoute, type RouteOption } from './audioRoute';
import { emitAck, getSocket } from './socket';

/** Camera capture: up to Full HD. WebRTC lowers it on its own when the network or the phone can't keep up. */
const CAMERA: MediaTrackConstraints = { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } };
/** Ceiling for the video we send (browsers stop around 2.5 Mbit/s by default); congestion control adapts below it. */
const VIDEO_MAX_BITRATE = 4_500_000;

export type Phase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'connected' | 'reconnecting' | 'ended';

export interface GroupTile {
  id: string;
  name: string;
  stream: MediaStream | null;
  audio: boolean;
  video: boolean;
  speaking: boolean;
  local: boolean;
}

export interface CallState {
  phase: Phase;
  callId: string | null;
  conversationId: string | null;
  type: CallType;
  group: boolean;
  title: string;
  peer: PublicUser | null;
  outgoing: boolean;
  /** Caller side: the other person has the site open, so their device is ringing. */
  reachable: boolean;
  connectedAt: number | null;
  local: MediaStream | null;
  remote: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  remoteMedia: { audio: boolean; video: boolean };
  /** Video call continuing without our camera (permission denied / no camera / user chose). */
  audioOnlyFallback: boolean;
  tiles: GroupTile[];
  error: string | null;
  endReason: string | null;
  canSwitchCamera: boolean;
  /** Where the call is heard: earpiece, speaker, Bluetooth or wired headset (null: browser decides). */
  audioRoute: AudioRoute | null;
  /** Routes the user can switch between (empty when the browser can't switch, e.g. iPhone Safari). */
  audioRoutes: RouteOption[];
  /** Output device for audio / video elements (setSinkId), when the route is chosen that way. */
  sinkId: string | null;
  /** Do not disturb during the call: no message toasts / notifications over it (on by default). */
  dnd: boolean;
}

const initial: CallState = {
  phase: 'idle',
  callId: null,
  conversationId: null,
  type: 'AUDIO',
  group: false,
  title: '',
  peer: null,
  outgoing: false,
  reachable: false,
  connectedAt: null,
  local: null,
  remote: null,
  micOn: true,
  camOn: true,
  remoteMedia: { audio: true, video: true },
  audioOnlyFallback: false,
  tiles: [],
  error: null,
  endReason: null,
  canSwitchCamera: false,
  audioRoute: null,
  audioRoutes: [],
  sinkId: null,
  dnd: true,
};

/** Human message for getUserMedia failures. */
export function mediaError(e: unknown, type: CallType): string {
  const name = (e as { name?: string })?.name;
  const what = type === 'VIDEO' ? 'camera and microphone' : 'microphone';
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser can’t make calls here. Use a recent browser over https.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return `Allow ${what} access in your browser’s site settings, then try again.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `No ${type === 'VIDEO' ? 'camera or ' : ''}microphone was found on this device.`;
  if (name === 'NotReadableError' || name === 'AbortError') return `Your ${what} is being used by another app. Close it and try again.`;
  return `Couldn’t start your ${what}.`;
}

class Tone {
  private ctx: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  play(kind: 'ring' | 'ringback') {
    this.stop();
    // The shared output was unlocked by an earlier tap, so it also rings while the app is in the background.
    this.ctx = sharedAudio();
    if (!this.ctx) return;
    const beep = () => {
      const ctx = this.ctx;
      if (!ctx) return;
      const now = ctx.currentTime;
      const freqs = kind === 'ring' ? [880, 660] : [440];
      freqs.forEach((f, i) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, now + i * 0.25);
        g.gain.exponentialRampToValueAtTime(kind === 'ring' ? 0.15 : 0.06, now + i * 0.25 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.25 + (kind === 'ring' ? 0.22 : 1));
        o.connect(g).connect(ctx.destination);
        o.start(now + i * 0.25);
        o.stop(now + i * 0.25 + 1.05);
      });
    };
    beep();
    this.timer = setInterval(beep, kind === 'ring' ? 1500 : 3000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Shared output: not closed, just no new beeps.
    this.ctx = null;
  }
}

export class CallController {
  state: CallState = initial;
  private listeners = new Set<() => void>();
  private pc: RTCPeerConnection | null = null;
  private pendingIce: RTCIceCandidateInit[] = [];
  private remoteSet = false;
  private room: Room | null = null;
  private tone = new Tone();
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private failTimer: ReturnType<typeof setTimeout> | null = null;
  private resetTimer: ReturnType<typeof setTimeout> | null = null;
  private myId = '';
  private bound = false;
  private routeBusy: Promise<void> = Promise.resolve();

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;
  private set(patch: Partial<CallState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  /** Connects socket events once (after login). */
  bind(myId: string) {
    this.myId = myId;
    if (this.bound) return;
    this.bound = true;
    this.listenToNotifications();
    const s = getSocket();
    s.on('call:incoming', (c) => {
      // The same call sent again (this tab reconnected, or opened from the notification).
      if (c.callId === this.state.callId && this.state.phase !== 'ended') {
        this.answerFromNotification(c.callId);
        return;
      }
      if (this.state.phase !== 'idle' && this.state.phase !== 'ended') {
        // Already on a call: tell the caller we're busy (group calls just keep ringing others).
        if (!c.group) s.emit('call:reject', { callId: c.callId, reason: 'busy' });
        return;
      }
      clearTimeout(this.resetTimer ?? undefined);
      this.set({
        ...initial,
        phase: 'incoming',
        callId: c.callId,
        conversationId: c.conversationId,
        type: c.type,
        group: c.group,
        title: c.group ? c.groupName ?? 'Group call' : c.from.displayName,
        peer: c.from,
        camOn: c.type === 'VIDEO',
      });
      this.tone.play('ring');
      void localNotify({
        title: `Incoming ${c.type === 'VIDEO' ? 'video' : 'voice'} call`,
        body: `${c.group ? `${c.from.displayName} · ${c.groupName ?? 'Group'}` : c.from.displayName} · tap to answer`,
        link: `/chats/${c.conversationId}?call=${c.callId}`,
        tag: `call-${c.callId}`,
        call: true,
        callId: c.callId,
      });
      this.answerFromNotification(c.callId);
    });
    s.on('call:accepted', ({ callId, userId }) => {
      if (callId !== this.state.callId) return;
      if (userId === this.myId) {
        // Answered on another tab / device.
        if (this.state.phase === 'incoming') this.finish('Answered on another device', false);
        return;
      }
      if (this.state.group) return;
      if (this.state.outgoing && this.state.phase === 'outgoing') {
        this.tone.stop();
        this.set({ phase: 'connecting' });
        void this.makeOffer(false);
      }
    });
    s.on('call:rejected', ({ callId, userId, reason }) => {
      if (callId !== this.state.callId || this.state.group) return;
      if (userId === this.myId) {
        if (this.state.phase === 'incoming') this.finish('Declined', false);
        return;
      }
      this.finish(reason === 'busy' ? 'Busy on another call' : 'Call declined', false);
    });
    s.on('call:ended', ({ callId, status }) => {
      if (callId !== this.state.callId) return;
      const reason =
        status === 'MISSED' ? (this.state.outgoing ? 'No answer' : 'Missed call') : status === 'BUSY' ? 'Busy on another call' : status === 'REJECTED' ? 'Call declined' : 'Call ended';
      this.finish(reason, false);
    });
    s.on('call:signal', ({ callId, from, data }) => {
      if (callId !== this.state.callId || this.state.peer?.id !== from) return;
      void this.onSignal(data);
    });
    s.on('call:media', ({ callId, audio, video }) => {
      if (callId !== this.state.callId) return;
      // The other person turned their camera on in a voice call: show the video layout.
      const upgrade = video && this.state.type === 'AUDIO';
      this.set({ remoteMedia: { audio, video }, ...(upgrade ? { type: 'VIDEO' as const } : {}) });
      if (upgrade && this.state.audioRoute === 'earpiece') void this.setAudioRoute('speaker');
    });
    s.on('call:resumed', ({ callId }) => {
      // The other side got a new socket; the caller restarts ICE so media finds its way again.
      if (callId === this.state.callId && this.state.outgoing && !this.state.group) void this.makeOffer(true);
    });
    s.on('call:left', ({ callId, userId }) => {
      if (callId === this.state.callId && this.state.group) this.set({ tiles: this.state.tiles.filter((t) => t.id !== userId) });
    });
    s.on('connect', () => {
      // Our own socket reconnected mid-call: take the call over on this connection.
      const { callId, phase } = this.state;
      if (!callId || !['connecting', 'connected', 'reconnecting'].includes(phase)) return;
      emitAck('call:resume', { callId }).then(
        () => {
          if (this.state.outgoing && !this.state.group) void this.makeOffer(true);
        },
        () => this.finish('Connection lost', false),
      );
    });
  }

  /** "Answer" on the call notification opens the app with ?call=<id>&answer=1: pick up straight away. */
  private answerFromNotification(callId: string) {
    const q = new URLSearchParams(location.search);
    if (q.get('call') !== callId || q.get('answer') !== '1') return;
    q.delete('answer');
    q.delete('call');
    const rest = q.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
    if (this.state.phase === 'incoming') void this.accept();
  }

  /** The call notification's Mute button: silence the ringtone here too. */
  private listenToNotifications() {
    navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
      const d = e.data as { type?: string; callId?: string } | null;
      if (d?.type === 'call-mute' && d.callId === this.state.callId && this.state.phase === 'incoming') this.tone.stop();
    });
  }

  private async getMedia(type: CallType): Promise<{ stream: MediaStream; fallback: boolean }> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(mediaError(null, type));
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (type === 'AUDIO') {
      try {
        return { stream: await navigator.mediaDevices.getUserMedia({ audio }), fallback: false };
      } catch (e) {
        throw new Error(mediaError(e, type));
      }
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: { ...CAMERA, facingMode: 'user' } });
      return { stream, fallback: false };
    } catch (e) {
      // No camera / camera refused: carry on with voice only.
      try {
        return { stream: await navigator.mediaDevices.getUserMedia({ audio }), fallback: true };
      } catch {
        throw new Error(mediaError(e, type));
      }
    }
  }

  private async countCameras() {
    try {
      const d = await navigator.mediaDevices.enumerateDevices();
      return d.filter((x) => x.kind === 'videoinput').length;
    } catch {
      return 0;
    }
  }

  async start(conversationId: string, type: CallType, title: string, peer: PublicUser | null, group: boolean) {
    if (this.state.phase !== 'idle' && this.state.phase !== 'ended') throw new Error('You are already in a call');
    clearTimeout(this.resetTimer ?? undefined);
    this.set({ ...initial, phase: 'outgoing', conversationId, type, title, peer, group, outgoing: true, camOn: type === 'VIDEO' });
    let media: { stream: MediaStream; fallback: boolean };
    try {
      media = await this.getMedia(type);
    } catch (e) {
      this.set({ ...initial });
      throw e;
    }
    this.set({ local: media.stream, audioOnlyFallback: media.fallback, camOn: type === 'VIDEO' && !media.fallback, canSwitchCamera: (await this.countCameras()) > 1 });
    await this.setupAudioRoute();
    try {
      const res = await emitAck<{ callId: string; reachable: boolean; sfu: boolean }>('call:start', { conversationId, type });
      this.set({ callId: res.callId, reachable: res.reachable });
      if (res.sfu) {
        await this.joinRoom(res.callId);
      } else {
        this.tone.play('ringback');
      }
    } catch (e) {
      this.stopLocal();
      this.set({ ...initial });
      throw e;
    }
  }

  async accept() {
    const { callId, type, phase } = this.state;
    if (!callId || phase !== 'incoming') return;
    this.tone.stop();
    void closeNotification(`call-${callId}`);
    let media: { stream: MediaStream; fallback: boolean };
    try {
      media = await this.getMedia(type);
    } catch (e) {
      getSocket().emit('call:reject', { callId });
      this.finish((e as Error).message, false, (e as Error).message);
      return;
    }
    this.set({ local: media.stream, audioOnlyFallback: media.fallback, camOn: type === 'VIDEO' && !media.fallback, phase: 'connecting', canSwitchCamera: (await this.countCameras()) > 1 });
    await this.setupAudioRoute();
    try {
      const res = await emitAck<{ sfu: boolean }>('call:accept', { callId });
      if (res.sfu) await this.joinRoom(callId);
      else {
        await this.createPc();
        this.sendMedia();
      }
    } catch (e) {
      this.finish((e as Error).message, false, (e as Error).message);
    }
  }

  /** Join a group call that is already running (from the chat header). */
  async joinGroup(callId: string, conversationId: string, type: CallType, title: string) {
    if (this.state.phase !== 'idle' && this.state.phase !== 'ended') throw new Error('You are already in a call');
    this.set({ ...initial, phase: 'incoming', callId, conversationId, type, title, group: true });
    await this.accept();
  }

  decline() {
    const { callId } = this.state;
    if (callId) getSocket().emit('call:reject', { callId });
    this.finish('Declined', false);
  }

  hangUp() {
    const { callId } = this.state;
    if (callId) getSocket().emit('call:end', { callId });
    this.finish('Call ended', false);
  }

  toggleDnd() {
    this.set({ dnd: !this.state.dnd });
  }

  toggleMic() {
    const on = !this.state.micOn;
    this.state.local?.getAudioTracks().forEach((t) => (t.enabled = on));
    void this.room?.localParticipant.setMicrophoneEnabled(on);
    this.set({ micOn: on });
    this.sendMedia();
  }

  /**
   * Camera on / off. In a voice call (or a video call that started without camera access) turning it on
   * opens the camera and makes it a video call, without ringing again.
   */
  async toggleCam() {
    if (this.state.phase === 'idle' || this.state.phase === 'ended' || this.state.phase === 'incoming') return;
    const on = !this.state.camOn;
    if (on && !this.room && !this.state.local?.getVideoTracks().length) return this.startVideo();
    this.state.local?.getVideoTracks().forEach((t) => (t.enabled = on));
    if (this.room) {
      try {
        await this.room.localParticipant.setCameraEnabled(on);
      } catch (e) {
        throw new Error(mediaError(e, 'VIDEO'));
      }
    }
    const wasEarpiece = on && this.state.audioRoute === 'earpiece';
    this.set({ camOn: on, ...(on ? { type: 'VIDEO' as const, audioOnlyFallback: false } : {}) });
    this.sendMedia();
    if (wasEarpiece) void this.setAudioRoute('speaker');
  }

  /** Opens the camera mid-call and sends it in the video slot every 1:1 call has (see createPc). */
  private async startVideo() {
    let track: MediaStreamTrack;
    try {
      track = (await navigator.mediaDevices.getUserMedia({ video: { ...CAMERA, facingMode: 'user' } })).getVideoTracks()[0];
    } catch (e) {
      throw new Error(mediaError(e, 'VIDEO'));
    }
    const local = this.state.local;
    if (!local || this.state.phase === 'idle' || this.state.phase === 'ended') {
      track.stop();
      return;
    }
    if (this.pc) {
      const slot = this.pc.getTransceivers().find((t) => t.receiver.track.kind === 'video' && (t.currentDirection ?? t.direction).includes('send'));
      if (!slot) {
        track.stop();
        throw new Error('The other person’s app is out of date, so video can’t be added to this call. Start a video call instead.');
      }
      await slot.sender.replaceTrack(track);
    }
    local.addTrack(track);
    const wasEarpiece = this.state.audioRoute === 'earpiece';
    this.set({ local: new MediaStream(local.getTracks()), camOn: true, type: 'VIDEO', audioOnlyFallback: false, canSwitchCamera: (await this.countCameras()) > 1 });
    this.sendMedia();
    if (this.pc) void this.tuneSenders(this.pc);
    // Like a phone: video calls are on the loudspeaker.
    if (wasEarpiece) void this.setAudioRoute('speaker');
  }

  /** Cycles to the next camera (front / back on phones). */
  async switchCamera() {
    const local = this.state.local;
    const current = local?.getVideoTracks()[0];
    if (!local || !current) return;
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
    if (cams.length < 2) return;
    const idx = cams.findIndex((c) => c.deviceId === current.getSettings().deviceId);
    const next = cams[(idx + 1) % cams.length];
    const stream = await navigator.mediaDevices.getUserMedia({ video: { ...CAMERA, deviceId: { exact: next.deviceId } } });
    const track = stream.getVideoTracks()[0];
    track.enabled = this.state.camOn;
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === 'video');
    await sender?.replaceTrack(track);
    if (this.room) await this.room.switchActiveDevice('videoinput', next.deviceId);
    local.removeTrack(current);
    current.stop();
    local.addTrack(track);
    this.set({ local: new MediaStream(local.getTracks()) });
  }

  private sendMedia() {
    const { callId, micOn, camOn } = this.state;
    if (callId) getSocket().emit('call:media', { callId, audio: micOn, video: camOn });
  }

  // ----- audio route: earpiece / speaker / Bluetooth / headphones -----

  /** Picks the starting route (headset if connected, else earpiece for voice, speaker for video). */
  private async setupAudioRoute() {
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.watchMic();
    void this.keepAwake();
    const options = await listRoutes();
    this.set({ audioRoutes: options });
    const first = defaultRoute(options, this.state.type === 'VIDEO');
    if (first) await this.setAudioRoute(first.route);
  }

  private deviceTimer: ReturnType<typeof setTimeout> | null = null;
  private recheckWhenVisible = false;

  /** Bluetooth / headphones plugged in or removed during the call (several events come at once: wait a bit). */
  private onDeviceChange = () => {
    if (this.state.phase === 'idle' || this.state.phase === 'ended') return;
    clearTimeout(this.deviceTimer ?? undefined);
    this.deviceTimer = setTimeout(() => void this.recheckRoutes(), 800);
  };

  private async recheckRoutes() {
    if (this.state.phase === 'idle' || this.state.phase === 'ended') return;
    // Screen off / app in the background: browsers refuse to open a microphone then, and switching would
    // leave the call silent. Re-check when the app is visible again.
    if (document.visibilityState === 'hidden') {
      this.recheckWhenVisible = true;
      return;
    }
    const before = this.state.audioRoutes;
    const options = await listRoutes();
    // The same list again (Android fires this when the screen turns off/on): nothing to do.
    if (options.length && options.map((o) => o.route).join() === before.map((o) => o.route).join()) {
      this.set({ audioRoutes: options });
      return;
    }
    // An empty list while the call runs is a glitch, not "every device was unplugged".
    if (!options.length) return;
    this.set({ audioRoutes: options });
    const added = options.find((o) => (o.route === 'bluetooth' || o.route === 'wired') && !before.some((b) => b.route === o.route));
    const currentGone = this.state.audioRoute && !options.some((o) => o.route === this.state.audioRoute);
    if (added) await this.setAudioRoute(added.route);
    else if (currentGone) {
      const next = defaultRoute(options, this.state.type === 'VIDEO');
      if (next) await this.setAudioRoute(next.route);
      else this.set({ audioRoute: null, sinkId: null });
    }
  }

  private onVisibility = () => {
    if (this.state.phase === 'idle' || this.state.phase === 'ended' || document.visibilityState !== 'visible') return;
    void this.keepAwake();
    void this.ensureMic();
    if (this.recheckWhenVisible) {
      this.recheckWhenVisible = false;
      void this.recheckRoutes();
    }
  };

  /** If the phone took the microphone away (screen locked, another app), get it back as soon as possible. */
  private watchMic() {
    const track = this.state.local?.getAudioTracks()[0];
    if (!track || (track as MediaStreamTrack & { _watched?: boolean })._watched) return;
    (track as MediaStreamTrack & { _watched?: boolean })._watched = true;
    track.addEventListener('ended', () => void this.ensureMic());
  }

  private async ensureMic() {
    if (this.room || this.state.phase === 'idle' || this.state.phase === 'ended') return;
    const current = this.state.local?.getAudioTracks()[0];
    if (current && current.readyState === 'live') return;
    const option = this.state.audioRoutes.find((o) => o.route === this.state.audioRoute);
    try {
      await this.replaceMic(option?.inputId ? { exact: option.inputId } : undefined);
    } catch {
      // Still hidden: onVisibility tries again.
    }
  }

  /** Keeps the screen from turning off by itself during a call (released when the call ends or the tab hides). */
  private wakeLock: { release: () => Promise<void> } | null = null;
  private async keepAwake() {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!wl || document.visibilityState !== 'visible') return;
    try {
      this.wakeLock = await wl.request('screen');
    } catch {
      // Battery saver or no permission: the screen may dim as usual.
    }
  }

  /** Speaker button: speaker ⇄ earpiece (or back to the headset when one is connected). */
  async toggleSpeaker() {
    const { audioRoute, audioRoutes } = this.state;
    if (audioRoute === 'speaker') {
      const back = audioRoutes.find((o) => o.route === 'bluetooth') ?? audioRoutes.find((o) => o.route === 'wired') ?? audioRoutes.find((o) => o.route === 'earpiece');
      if (back) await this.setAudioRoute(back.route);
    } else if (audioRoutes.some((o) => o.route === 'speaker')) {
      await this.setAudioRoute('speaker');
    }
  }

  /** Sends call audio to the given route. Serialised, so quick taps can't interleave. */
  setAudioRoute(route: AudioRoute): Promise<void> {
    const run = this.routeBusy.then(() => this.applyRoute(route)).catch((e) => console.warn('audio route failed', e));
    this.routeBusy = run;
    return run;
  }

  private async applyRoute(route: AudioRoute) {
    const option = this.state.audioRoutes.find((o) => o.route === route);
    if (!option) return;
    if (option.inputId) await this.useMicrophone(option.inputId);
    if (this.state.phase === 'idle' || this.state.phase === 'ended') return;
    this.set({ audioRoute: route, sinkId: option.outputId ?? null });
    if (option.outputId) await this.room?.switchActiveDevice('audiooutput', option.outputId).catch(() => {});
  }

  /** Switches the microphone (on Chrome / Android this also moves the call audio to that route). */
  private async useMicrophone(deviceId: string) {
    if (this.room) {
      await this.room.switchActiveDevice('audioinput', deviceId);
      return;
    }
    const current = this.state.local?.getAudioTracks()[0];
    if (!current || (current.readyState === 'live' && current.getSettings().deviceId === deviceId)) return;
    await this.replaceMic({ exact: deviceId });
  }

  /**
   * Opens a microphone and swaps it into the call. Never leaves the call without a microphone: if the new
   * one can't be opened, the previous one stays (or is reopened).
   */
  private async replaceMic(deviceId?: { exact: string }) {
    const local = this.state.local;
    if (!local) return;
    const current = local.getAudioTracks()[0];
    const audio = (id?: { exact: string }) => ({ audio: { ...(id ? { deviceId: id } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const open = async (id?: { exact: string }) => (await navigator.mediaDevices.getUserMedia(audio(id))).getAudioTracks()[0];
    let track: MediaStreamTrack;
    try {
      track = await open(deviceId);
    } catch (e) {
      const name = (e as { name?: string }).name;
      // Some phones open only one microphone at a time: release ours and retry — but only for that error.
      if ((name !== 'NotReadableError' && name !== 'AbortError') || !current || current.readyState !== 'live') throw e;
      const previous = current.getSettings().deviceId;
      current.stop();
      try {
        track = await open(deviceId);
      } catch {
        track = await open(previous ? { exact: previous } : undefined);
      }
    }
    if (this.state.local !== local || this.state.phase === 'idle' || this.state.phase === 'ended') {
      track.stop();
      return;
    }
    track.enabled = this.state.micOn;
    await this.pc?.getTransceivers().find((t) => t.receiver.track.kind === 'audio')?.sender.replaceTrack(track);
    if (current) {
      local.removeTrack(current);
      current.stop();
    }
    local.addTrack(track);
    this.set({ local: new MediaStream(local.getTracks()) });
    this.watchMic();
  }

  // ----- 1:1 WebRTC -----

  private async createPc() {
    let ice: IceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], ttl: 0 };
    try {
      ice = await api.get<IceConfig>('/calls/ice-servers');
    } catch {
      // STUN-only fallback still works on most home networks.
    }
    const pc = new RTCPeerConnection({ iceServers: ice.iceServers, iceCandidatePoolSize: 2 });
    this.pc = pc;
    this.remoteSet = false;
    this.pendingIce = [];
    const remote = new MediaStream();
    this.set({ remote });
    this.state.local?.getTracks().forEach((t) => pc.addTrack(t, this.state.local!));
    // A video call that fell back to voice still receives the other side's video.
    // Every 1:1 call has room for video, so a voice call can become a video call later without a new
    // offer (only the caller sends offers). The callee opens its side of the slot in onSignal.
    if (this.state.outgoing && !this.state.local?.getVideoTracks().length) pc.addTransceiver('video', { direction: 'sendrecv' });
    pc.ontrack = (e) => {
      if (!remote.getTracks().includes(e.track)) remote.addTrack(e.track);
      this.set({ remote: new MediaStream(remote.getTracks()) });
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.signal({ type: 'candidate', candidate: e.candidate.toJSON() as { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } });
    };
    pc.onconnectionstatechange = () => this.onConnState(pc);
    return pc;
  }

  private onConnState(pc: RTCPeerConnection) {
    if (pc !== this.pc) return;
    const st = pc.connectionState;
    if (st === 'connected') {
      clearTimeout(this.restartTimer ?? undefined);
      clearTimeout(this.failTimer ?? undefined);
      this.set({ phase: 'connected', connectedAt: this.state.connectedAt ?? Date.now() });
      void this.tuneSenders(pc);
    } else if (st === 'disconnected' || st === 'failed') {
      if (this.state.phase === 'connected' || this.state.phase === 'connecting') this.set({ phase: 'reconnecting' });
      // Network changed (Wi-Fi ↔ mobile data): restart ICE; give up after 30 s.
      clearTimeout(this.restartTimer ?? undefined);
      this.restartTimer = setTimeout(() => {
        if (this.state.outgoing) void this.makeOffer(true);
      }, st === 'failed' ? 0 : 4000);
      if (!this.failTimer) this.failTimer = setTimeout(() => {
        if (this.pc?.connectionState !== 'connected') {
          this.hangUp();
          this.set({ endReason: 'Connection lost' });
        }
      }, 30_000);
    }
  }

  /**
   * Quality follows the network: video may go up to Full HD on a good connection, and when bandwidth
   * is short the voice goes first and video drops resolution rather than frame rate.
   */
  private async tuneSenders(pc: RTCPeerConnection) {
    for (const sender of pc.getSenders()) {
      const kind = sender.track?.kind;
      const params = sender.getParameters();
      if (!kind || !params.encodings?.length) continue;
      for (const enc of params.encodings) {
        if (kind === 'video') {
          enc.maxBitrate = VIDEO_MAX_BITRATE;
          enc.maxFramerate = 30;
        } else {
          enc.priority = 'high';
          enc.networkPriority = 'high';
        }
      }
      if (kind === 'video') params.degradationPreference = 'maintain-framerate';
      // Older browsers reject some of these fields; the call works the same without them.
      await sender.setParameters(params).catch(() => {});
    }
  }

  private signal(data: SignalData) {
    const { callId, peer } = this.state;
    if (callId && peer) getSocket().emit('call:signal', { callId, to: peer.id, data });
  }

  private async makeOffer(iceRestart: boolean) {
    const pc = this.pc ?? (await this.createPc());
    if (pc.signalingState !== 'stable') return;
    const offer = await pc.createOffer({ iceRestart });
    await pc.setLocalDescription(offer);
    this.signal({ type: 'offer', sdp: offer.sdp ?? '' });
    this.sendMedia();
  }

  private async onSignal(data: SignalData) {
    const pc = this.pc ?? (this.state.outgoing ? null : await this.createPc());
    if (!pc) return;
    try {
      if (data.type === 'offer') {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        this.remoteSet = true;
        // Answer the caller's video slot as send + receive, so our camera can be turned on mid-call.
        for (const t of pc.getTransceivers()) if (t.receiver.track.kind === 'video' && t.direction === 'recvonly') t.direction = 'sendrecv';
        await this.flushIce();
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.signal({ type: 'answer', sdp: answer.sdp ?? '' });
      } else if (data.type === 'answer') {
        if (pc.signalingState !== 'have-local-offer') return;
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        this.remoteSet = true;
        await this.flushIce();
      } else if (data.type === 'candidate') {
        if (!this.remoteSet) this.pendingIce.push(data.candidate);
        else await pc.addIceCandidate(data.candidate).catch(() => {});
      }
    } catch (e) {
      console.warn('signal failed', e);
    }
  }

  private async flushIce() {
    const list = this.pendingIce;
    this.pendingIce = [];
    for (const c of list) await this.pc?.addIceCandidate(c).catch(() => {});
  }

  // ----- group calls (LiveKit) -----

  private async joinRoom(callId: string) {
    const { url, token } = await api.post<{ url: string; token: string }>(`/calls/${callId}/token`);
    const lk = await import('livekit-client');
    const room = new lk.Room({ adaptiveStream: true, dynacast: true });
    this.room = room;
    const refresh = () => {
      const tiles: GroupTile[] = [];
      const add = (p: import('livekit-client').Participant, local: boolean) => {
        const tracks = [...p.trackPublications.values()].map((t) => t.track).filter((t): t is NonNullable<typeof t> => Boolean(t));
        const ms = tracks.length ? new MediaStream(tracks.map((t) => t.mediaStreamTrack)) : null;
        tiles.push({ id: p.identity, name: p.name || p.identity, stream: ms, audio: p.isMicrophoneEnabled, video: p.isCameraEnabled, speaking: p.isSpeaking, local });
      };
      add(room.localParticipant, true);
      room.remoteParticipants.forEach((p) => add(p, false));
      this.set({ tiles, phase: 'connected', connectedAt: this.state.connectedAt ?? Date.now() });
    };
    for (const ev of [
      lk.RoomEvent.ParticipantConnected,
      lk.RoomEvent.ParticipantDisconnected,
      lk.RoomEvent.TrackSubscribed,
      lk.RoomEvent.TrackUnsubscribed,
      lk.RoomEvent.TrackMuted,
      lk.RoomEvent.TrackUnmuted,
      lk.RoomEvent.LocalTrackPublished,
      lk.RoomEvent.ActiveSpeakersChanged,
    ]) room.on(ev, refresh);
    room.on(lk.RoomEvent.Reconnecting, () => this.set({ phase: 'reconnecting' }));
    room.on(lk.RoomEvent.Reconnected, refresh);
    room.on(lk.RoomEvent.Disconnected, () => {
      if (this.room === room) this.hangUp();
    });
    await room.connect(url, token);
    // The SFU publishes its own tracks; our preview stream is no longer needed.
    this.stopLocal();
    await room.localParticipant.setMicrophoneEnabled(this.state.micOn);
    if (this.state.type === 'VIDEO') await room.localParticipant.setCameraEnabled(this.state.camOn).catch(() => this.set({ camOn: false, audioOnlyFallback: true }));
    refresh();
    // LiveKit opened its own microphone: put it back on the chosen route (earpiece / speaker / headset).
    if (this.state.audioRoute) await this.setAudioRoute(this.state.audioRoute);
  }

  // ----- cleanup -----

  private stopLocal() {
    this.state.local?.getTracks().forEach((t) => t.stop());
  }

  private finish(reason: string, keepError: boolean, error: string | null = null) {
    this.tone.stop();
    if (this.state.callId) void closeNotification(`call-${this.state.callId}`);
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    document.removeEventListener('visibilitychange', this.onVisibility);
    clearTimeout(this.deviceTimer ?? undefined);
    this.recheckWhenVisible = false;
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    clearTimeout(this.restartTimer ?? undefined);
    clearTimeout(this.failTimer ?? undefined);
    this.failTimer = null;
    this.stopLocal();
    this.pc?.close();
    this.pc = null;
    void this.room?.disconnect();
    this.room = null;
    if (this.state.phase === 'idle') return;
    this.set({ phase: 'ended', endReason: this.state.endReason ?? reason, error: keepError ? this.state.error : error, local: null, remote: null, tiles: [] });
    clearTimeout(this.resetTimer ?? undefined);
    this.resetTimer = setTimeout(() => this.set({ ...initial }), 2500);
  }
}

export const calls = new CallController();
