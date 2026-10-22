import type { IceConfig } from '@baatcheet/shared';
import { config } from '../config.js';
import { hmac } from './crypto.js';

const split = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/**
 * ICE servers for one user. TURN uses coturn's REST-API scheme (use-auth-secret):
 * username = "<expiry unix time>:<user id>", password = base64(HMAC-SHA1(secret, username)).
 * The credentials stop working after TURN_TTL_SECONDS, so a leaked one is useless later.
 */
export function iceConfigFor(userId: string): IceConfig {
  const iceServers: IceConfig['iceServers'] = [];
  const stun = split(config.STUN_URLS);
  if (stun.length) iceServers.push({ urls: stun });
  const turn = split(config.TURN_URLS);
  if (turn.length && config.TURN_SECRET) {
    const username = `${Math.floor(Date.now() / 1000) + config.TURN_TTL_SECONDS}:${userId}`;
    const credential = hmac(config.TURN_SECRET, username, 'sha1').toString('base64');
    iceServers.push({ urls: turn, username, credential });
  } else if (turn.length && config.TURN_USERNAME && config.TURN_CREDENTIAL) {
    // A hosted TURN service with a fixed login (it can't be per-user or expiring).
    iceServers.push({ urls: turn, username: config.TURN_USERNAME, credential: config.TURN_CREDENTIAL });
  }
  return { iceServers, ttl: config.TURN_TTL_SECONDS };
}
