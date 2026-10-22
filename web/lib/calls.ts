'use client';
// Voice / video calls in the browser.
// 1:1 calls: RTCPeerConnection between the two browsers; offers, answers and ICE candidates go
// through the authenticated Socket.IO connection. Only the caller ever sends offers (also for ICE
// restarts), so the two sides can't both offer at once.
// Group calls: LiveKit (SFU). The server rings members and hands out a room token.
import type { CallType, IceConfig, PublicUser, SignalData } from '@baatcheet/shared';
import type { Room } from 'livekit-client';
import { api } from './api';
import { defaultRoute, listRoutes, type AudioRoute, type RouteOption } from './audioRoute';
import { emitAck, getSocket } from './socket';

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
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
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
    void this.ctx?.close().catch(() => {});
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
    const s = getSocket();
    s.on('call:incoming', (c) => {
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
      this.notifyIncoming(c.from.displayName, c.type, c.group ? c.groupName : null);
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
      if (callId === this.state.callId) this.set({ remoteMedia: { audio, video } });
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

  private notifyIncoming(name: string, type: CallType, group: string | null) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
    try {
      const n = new Notification(`Incoming ${type === 'VIDEO' ? 'video' : 'voice'} call`, { body: group ? `${name} · ${group}` : name, tag: 'call', requireInteraction: true });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      // Some browsers only allow notifications from a service worker.
    }
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } });
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

  toggleMic() {
    const on = !this.state.micOn;
    this.state.local?.getAudioTracks().forEach((t) => (t.enabled = on));
    void this.room?.localParticipant.setMicrophoneEnabled(on);
    this.set({ micOn: on });
    this.sendMedia();
  }

  toggleCam() {
    if (this.state.type !== 'VIDEO' || this.state.audioOnlyFallback) return;
    const on = !this.state.camOn;
    this.state.local?.getVideoTracks().forEach((t) => (t.enabled = on));
    void this.room?.localParticipant.setCameraEnabled(on);
    this.set({ camOn: on });
    this.sendMedia();
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
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: next.deviceId } } });
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
    const options = await listRoutes();
    this.set({ audioRoutes: options });
    const first = defaultRoute(options, this.state.type === 'VIDEO');
    if (first) await this.setAudioRoute(first.route);
  }

  /** Bluetooth / headphones plugged in or removed during the call. */
  private onDeviceChange = () => {
    if (this.state.phase === 'idle' || this.state.phase === 'ended') return;
    void (async () => {
      const before = this.state.audioRoutes;
      const options = await listRoutes();
      this.set({ audioRoutes: options });
      const added = options.find((o) => (o.route === 'bluetooth' || o.route === 'wired') && !before.some((b) => b.route === o.route));
      const currentGone = this.state.audioRoute && !options.some((o) => o.route === this.state.audioRoute);
      if (added) await this.setAudioRoute(added.route);
      else if (currentGone) {
        const next = defaultRoute(options, this.state.type === 'VIDEO');
        if (next) await this.setAudioRoute(next.route);
        else this.set({ audioRoute: null, sinkId: null });
      }
    })();
  };

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
    const local = this.state.local;
    const current = local?.getAudioTracks()[0];
    if (!local || !current || current.getSettings().deviceId === deviceId) return;
    const constraints = { audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
    let track: MediaStreamTrack;
    try {
      track = (await navigator.mediaDevices.getUserMedia(constraints)).getAudioTracks()[0];
    } catch {
      // Some phones can open only one microphone at a time: release the current one and retry.
      current.stop();
      track = (await navigator.mediaDevices.getUserMedia(constraints)).getAudioTracks()[0];
    }
    if (this.state.local !== local || this.state.phase === 'idle' || this.state.phase === 'ended') {
      track.stop();
      return;
    }
    track.enabled = this.state.micOn;
    await this.pc?.getSenders().find((x) => x.track?.kind === 'audio' || x.track === current)?.replaceTrack(track);
    local.removeTrack(current);
    current.stop();
    local.addTrack(track);
    this.set({ local: new MediaStream(local.getTracks()) });
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
    if (this.state.type === 'VIDEO' && !this.state.local?.getVideoTracks().length) pc.addTransceiver('video', { direction: 'recvonly' });
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
    } else if (st === 'disconnected' || st === 'failed') {
      if (this.state.phase === 'connected' || this.state.phase === 'connecting') this.set({ phase: 'reconnecting' });
      // Network changed (Wi-Fi ↔ mobile data): restart ICE; give up after 30 s.
      clearTimeout(this.restartTimer ?? undefined);
      this.restartTimer = setTimeout(() => {
        if (this.state.outgoing) void this.makeOffer(true);
      }, st === 'failed' ? 0 : 2500);
      if (!this.failTimer) this.failTimer = setTimeout(() => {
        if (this.pc?.connectionState !== 'connected') {
          this.hangUp();
          this.set({ endReason: 'Connection lost' });
        }
      }, 30_000);
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
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
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
