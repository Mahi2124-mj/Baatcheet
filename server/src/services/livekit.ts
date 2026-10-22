import { AccessToken } from 'livekit-server-sdk';
import { config } from '../config.js';

export const livekitEnabled = () => Boolean(config.LIVEKIT_URL && config.LIVEKIT_API_KEY && config.LIVEKIT_API_SECRET);

/** A 2-hour token that lets one user publish and subscribe in one room. */
export async function livekitToken(room: string, userId: string, name: string) {
  const at = new AccessToken(config.LIVEKIT_API_KEY, config.LIVEKIT_API_SECRET, { identity: userId, name, ttl: 2 * 3600 });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false });
  return { url: config.LIVEKIT_URL!, token: await at.toJwt() };
}
