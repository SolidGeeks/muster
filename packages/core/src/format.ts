export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function fmtSla(m: number): string {
  m = +m || 0;
  if (m < 60) return `${m} min`;
  if (m < 1440) {
    const h = Math.floor(m / 60), r = m % 60;
    return `${h} h${r ? ' ' + String(r).padStart(2, '0') : ''}`;
  }
  const d = m / 1440;
  return `${Number.isInteger(d) ? d : d.toFixed(1)} d`;
}

export function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min ${String(x).padStart(2, '0')} s`;
  return `${x} s`;
}

export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(v => String(v).padStart(2, '0')).join(':');
}

export function fmtT(ms: number): string {
  const m = Math.floor(ms / 60000);
  return `T+${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function fmtDate(iso: string | number): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function fmtLong(ms: number): string {
  return new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';
}

export function fmtHM(ms: number): string {
  return new Date(ms).toISOString().slice(11, 16);
}

export const LOG_LABEL: Record<string, string> = { ok: 'DONE', warn: 'WARN', crit: 'BREACH', dec: 'DECIDE', info: 'INFO' };
