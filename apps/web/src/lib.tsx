import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Role } from '@muster/core';
import { connectEvents, resolveNames, type Me } from '@muster/backend';

/* ---------- routing (hash based, so any static host works) ---------- */
export function useRoute(): string[] {
  const read = () => (location.hash.replace(/^#\/?/, '') || 'playbooks').split('/').filter(Boolean);
  const [parts, setParts] = useState(read);
  useEffect(() => {
    const on = () => setParts(read());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parts;
}
export const go = (path: string) => { location.hash = '#/' + path.replace(/^\//, ''); };

/* ---------- session ---------- */
const RANK: Record<Role, number> = { viewer: 1, analyst: 2, editor: 3, admin: 4 };
export const MeCtx = createContext<Me | null>(null);
export function useMe(): Me { return useContext(MeCtx)!; }
export function can(me: Me | null, role: Role): boolean { return !!me && RANK[me.role] >= RANK[role]; }

/* ---------- live updates ---------- */
type Change = { type: string; id: string; by?: string };
const listeners = new Set<(c: Change) => void>();
let stopFeed: (() => void) | null = null;
export function startEvents() {
  if (stopFeed) return;
  stopFeed = connectEvents(c => listeners.forEach(l => l(c)));
}
export function stopEvents() { stopFeed?.(); stopFeed = null; }
export function useChanges(fn: (c: Change) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const l = (c: Change) => ref.current(c);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
}

/* ---------- people ---------- */
// The server stores names; the online version stores ids and resolves them for each viewer.
const names = new Map<string, string>();
const pending = new Set<string>();
const nameSubs = new Set<() => void>();
let flushTimer: number | undefined;
function requestNames(refs: string[]) {
  let added = false;
  for (const r of refs) if (r && !names.has(r) && !pending.has(r)) { pending.add(r); added = true; }
  if (!added || flushTimer) return;
  flushTimer = window.setTimeout(async () => {
    flushTimer = undefined;
    const batch = [...pending]; pending.clear();
    try { const res = await resolveNames(batch); for (const r of batch) names.set(r, res[r] || r); }
    catch { for (const r of batch) names.set(r, r); }
    nameSubs.forEach(f => f());
  }, 0);
}
/** Returns a function that turns a stored person reference into a display name. */
export function useNames(): (ref?: string | null) => string {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump(x => x + 1); nameSubs.add(f); return () => { nameSubs.delete(f); }; }, []);
  return useCallback((ref?: string | null) => {
    if (!ref) return '';
    const n = names.get(ref);
    if (n !== undefined) return n;
    requestNames([ref]);
    return '…';
  }, []);
}

/* ---------- data loading ---------- */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: string | null; reload: () => Promise<void>; setData: (d: T) => void } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    try { const d = await fn(); if (n === seq.current) { setData(d); setError(null); } }
    catch (e) { if (n === seq.current) setError((e as Error).message); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { setData(undefined); setError(null); reload(); }, [reload]);
  return { data, error, reload, setData };
}

export function useNow(ms = 1000): number {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setN(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return n;
}

/* ---------- toasts ---------- */
type Toast = { id: number; msg: string; err?: boolean };
const ToastCtx = createContext<(msg: string, err?: boolean) => void>(() => {});
export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((msg: string, err = false) => {
    const id = Date.now() + Math.random();
    setItems(xs => [...xs.slice(-2), { id, msg, err }]);
    setTimeout(() => setItems(xs => xs.filter(x => x.id !== id)), err ? 5000 : 2800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{items.map(t => <div key={t.id} className={'toast' + (t.err ? ' err' : '')}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/* ---------- modal ---------- */
export function Modal({ title, kicker, onClose, children, actions, wide }: { title: string; kicker?: string; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = box.current?.querySelector<HTMLElement>('input,textarea,select,button.primary,button.signal');
    first?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="modal" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'mbox' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <div className="mh">{kicker && <span className="code">{kicker}</span>}<h2>{title}</h2></div>
        <div className="mb">{children}</div>
        {actions && <div className="mact">{actions}</div>}
      </div>
    </div>
  );
}

/** A destructive button that asks for a second click. */
export function ConfirmButton({ label, confirmLabel = 'Click again to confirm', onConfirm, className = 'btn sm danger', disabled }: { label: string; confirmLabel?: string; onConfirm: () => void; className?: string; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(t); }, [armed]);
  return <button className={className} disabled={disabled} onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? confirmLabel : label}</button>;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return <div className="loading"><div className="spinner" />{label}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="loading"><div className="err-banner" style={{ maxWidth: 520 }}><span>{message}</span>{onRetry && <button className="btn sm" onClick={onRetry}>Try again</button>}</div></div>;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?';
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/* ---------- icons ---------- */
export const Icon = {
  x: <svg viewBox="0 0 14 14"><path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" strokeWidth="1.4" /></svg>,
  up: <svg viewBox="0 0 12 12"><path d="M2.5 7.5 L6 4 L9.5 7.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>,
  down: <svg viewBox="0 0 12 12"><path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>,
  check: <svg viewBox="0 0 12 12"><path d="M2.5 6.2 L5 8.6 L9.8 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>,
  sun: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 1.5 V3 M8 13 V14.5 M1.5 8 H3 M13 8 H14.5 M3.4 3.4 L4.5 4.5 M11.5 11.5 L12.6 12.6 M3.4 12.6 L4.5 11.5 M11.5 4.5 L12.6 3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>,
  moon: <svg viewBox="0 0 16 16"><path d="M13.5 9.5 A5.5 5.5 0 1 1 6.5 2.5 A4.5 4.5 0 0 0 13.5 9.5 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>,
  search: <svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5 L14 14" stroke="currentColor" strokeWidth="1.5" /></svg>,
  plus: <svg viewBox="0 0 16 16"><path d="M8 3 V13 M3 8 H13" stroke="currentColor" strokeWidth="1.6" /></svg>,
  download: <svg viewBox="0 0 16 16"><path d="M8 2.5 V10 M4.5 6.5 L8 10 L11.5 6.5 M3 13.5 H13" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
};

export function Brand() {
  return (
    <a className="brand" href="#/playbooks">
      <svg viewBox="0 0 22 22" aria-hidden="true"><rect x="1" y="1" width="20" height="20" rx="5" style={{ fill: 'var(--ink)' }} /><path d="M5.5 15.5 V7 L11 12 L16.5 7 V15.5" fill="none" style={{ stroke: 'var(--card)' }} strokeWidth="2" strokeLinecap="square" /><circle cx="11" cy="16" r="1.9" fill="#FF5A1F" /></svg>
      Muster
    </a>
  );
}

/* ---------- theme ---------- */
export type ThemePref = 'light' | 'dark' | 'system';
const THEME_KEY = 'muster-theme';
export function readThemePref(): ThemePref {
  try { const v = localStorage.getItem(THEME_KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch { /* storage unavailable */ }
  return 'light';
}
const systemDark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
export function applyTheme(pref: ThemePref): boolean {
  const dark = pref === 'dark' || (pref === 'system' && systemDark());
  document.documentElement.setAttribute('data-muster-theme', dark ? 'dark' : 'light');
  return dark;
}
type ThemeState = { pref: ThemePref; dark: boolean; setPref: (p: ThemePref) => void };
export const ThemeCtx = createContext<ThemeState>({ pref: 'light', dark: false, setPref: () => {} });
export function useThemeState(): ThemeState {
  const [pref, setPrefState] = useState<ThemePref>(readThemePref);
  const [dark, setDark] = useState(() => applyTheme(readThemePref()));
  useEffect(() => {
    setDark(applyTheme(pref));
    try { localStorage.setItem(THEME_KEY, pref); } catch { /* storage unavailable */ }
    if (pref !== 'system' || typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setDark(applyTheme('system'));
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [pref]);
  return { pref, dark, setPref: setPrefState };
}
export const useTheme = () => useContext(ThemeCtx);

export function ThemeToggle() {
  const { dark, setPref } = useTheme();
  const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
  return <button className="theme-btn" onClick={() => setPref(dark ? 'light' : 'dark')} aria-label={label} title={`${label} (Shift+D)`}>{dark ? Icon.sun : Icon.moon}</button>;
}
