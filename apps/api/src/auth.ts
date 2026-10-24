import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import type { Store } from './db';
import type { Role } from '@muster/core';

export const ROLE_RANK: Record<Role, number> = { viewer: 1, analyst: 2, editor: 3, admin: 4 };
export const SESSION_COOKIE = 'muster_session';
const SESSION_MS = 12 * 60 * 60 * 1000;

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, n, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = scryptSync(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: 8, p: 1 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** A dummy hash so failed logins on unknown users take as long as on known ones. */
const DUMMY_HASH = hashPassword(randomBytes(12).toString('hex'));
export function burnTime(pw: string) { verifyPassword(pw, DUMMY_HASH); }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export function createSession(store: Store, userId: string): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  store.run('INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', sha(token), userId, now + SESSION_MS, now);
  store.run('DELETE FROM sessions WHERE expires_at < ?', now);
  return token;
}

export function sessionUser(store: Store, token: string | undefined) {
  if (!token) return undefined;
  const row = store.get<any>(`SELECT u.id, u.username, u.name, u.role, u.disabled, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`, sha(token));
  if (!row || row.disabled || row.expires_at < Date.now()) return undefined;
  return { id: row.id as string, username: row.username as string, name: row.name as string, role: row.role as Role };
}

export function destroySession(store: Store, token: string | undefined) {
  if (token) store.run('DELETE FROM sessions WHERE token_hash = ?', sha(token));
}

export function destroyUserSessions(store: Store, userId: string) {
  store.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

export function sessionCookie(token: string, secure: boolean, maxAgeMs = SESSION_MS): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? '; Secure' : ''}`;
}

/** Simple fixed-window limiter for login attempts. */
export class Limiter {
  private hits = new Map<string, { n: number; until: number }>();
  constructor(private max: number, private windowMs: number) {}
  check(key: string): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.until < now) return true;
    return h.n < this.max;
  }
  fail(key: string) {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.until < now) this.hits.set(key, { n: 1, until: now + this.windowMs });
    else h.n++;
    if (this.hits.size > 10000) for (const [k, v] of this.hits) if (v.until < now) this.hits.delete(k);
  }
  reset(key: string) { this.hits.delete(key); }
}

export function checkPasswordStrength(pw: unknown): string | null {
  if (typeof pw !== 'string') return 'Password is required';
  if (pw.length < 10) return 'Use at least 10 characters';
  if (pw.length > 200) return 'Use at most 200 characters';
  return null;
}
