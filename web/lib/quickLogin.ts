// Remembers who last logged in on this device, so the login page only needs the PIN next time.
// Only the username is kept (never the PIN or password); private mode simply forgets it.
const KEY = 'bc-last-login';

export function rememberLogin(username: string, hasPin: boolean) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ username, hasPin }));
  } catch {
    // Storage blocked: the user types the username again next time.
  }
}

export function lastLogin(): { username: string; hasPin: boolean } | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v && typeof v.username === 'string' ? { username: v.username, hasPin: Boolean(v.hasPin) } : null;
  } catch {
    return null;
  }
}

export function forgetLogin() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
}

/** 4–6 digits, not all the same digit, not a straight run like 1234 / 4321 (the server checks too). */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return 'The PIN must be 4 to 6 digits';
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'Too easy to guess — choose another PIN';
  return null;
}
