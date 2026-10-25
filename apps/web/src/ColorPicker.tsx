// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from 'react';

/* ---------- colour maths ---------- */
type RGB = { r: number; g: number; b: number };
type HSV = { h: number; s: number; v: number };

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hex.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
export const rgbToHex = ({ r, g, b }: RGB) => '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('').toUpperCase();
function rgbToHsv({ r, g, b }: RGB): HSV {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
function hsvToRgb({ h, s, v }: HSV): RGB {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}
function luminance({ r, g, b }: RGB) {
  const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/** WCAG contrast ratio of a colour against white (the report paper). */
export function contrastOnWhite(hex: string): number {
  const rgb = hexToRgb(hex);
  return rgb ? 1.05 / (luminance(rgb) + 0.05) : 1;
}
/** Darkens a colour, keeping its hue, until it reaches the target contrast on white. */
function darkenTo(hex: string, target: number): string {
  const rgb = hexToRgb(hex); if (!rgb) return hex;
  const hsv = rgbToHsv(rgb);
  for (let v = hsv.v; v >= 0; v -= 0.01) {
    const c = rgbToHex(hsvToRgb({ ...hsv, v }));
    if (contrastOnWhite(c) >= target) return c;
  }
  return '#121413';
}

/* ---------- presets & recent ---------- */
const PRESETS: { hex: string; name: string }[] = [
  { hex: '#FF5A1F', name: 'Signal orange' }, { hex: '#C2410C', name: 'Burnt orange' }, { hex: '#CC2A1E', name: 'Alert red' }, { hex: '#9F1239', name: 'Crimson' },
  { hex: '#A21CAF', name: 'Magenta' }, { hex: '#6D28D9', name: 'Violet' }, { hex: '#3A4FD1', name: 'Cobalt' }, { hex: '#1E3A8A', name: 'Navy' },
  { hex: '#0369A1', name: 'Ocean' }, { hex: '#0F766E', name: 'Teal' }, { hex: '#127548', name: 'Green' }, { hex: '#4D7C0F', name: 'Olive' },
  { hex: '#8A5A00', name: 'Ochre' }, { hex: '#78350F', name: 'Brown' }, { hex: '#475569', name: 'Slate' }, { hex: '#121413', name: 'Ink' }
];
const RECENT_KEY = 'muster-recent-colours';
function readRecent(): string[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string' && hexToRgb(x)).slice(0, 8) : []; } catch { return []; }
}
function pushRecent(hex: string) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([hex, ...readRecent().filter(x => x.toUpperCase() !== hex.toUpperCase())].slice(0, 8))); } catch { /* storage unavailable */ }
}

const EyeIcon = <svg viewBox="0 0 16 16"><path d="M10.5 2.5 L13.5 5.5 M9 4 L12 7 L5.5 13.5 H2.5 V10.5 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;

/**
 * Accent colour picker: colour field, hue slider, hex and RGB entry, presets, recent colours,
 * eyedropper where the browser has one, and a readability check against the white report paper.
 */
export function ColorPicker({ value, onChange, disabled, label = 'Accent colour' }: { value: string; onChange: (hex: string) => void; disabled?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(hexToRgb(value) || { r: 255, g: 90, b: 31 }));
  const [hexText, setHexText] = useState(value.toUpperCase());
  const [recent, setRecent] = useState<string[]>(readRecent);
  const root = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value.toUpperCase());
  // Latest HSV for drags, so a move never builds on a stale value.
  const hsvRef = useRef(hsv); hsvRef.current = hsv;

  // Follow outside changes (another editor, undo) without fighting the user's own edits.
  useEffect(() => {
    if (value.toUpperCase() === lastEmitted.current) return;
    const rgb = hexToRgb(value); if (!rgb) return;
    lastEmitted.current = value.toUpperCase();
    setHsv(rgbToHsv(rgb)); setHexText(value.toUpperCase());
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) finish(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); finish(); } };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc, true); };
  });

  const emit = (h: string) => { const up = h.toUpperCase(); if (up === lastEmitted.current) return; lastEmitted.current = up; onChange(up); };
  const setFromHsv = (next: HSV) => { hsvRef.current = next; setHsv(next); const h = rgbToHex(hsvToRgb(next)); setHexText(h); emit(h); };
  const setFromHex = (h: string) => { const rgb = hexToRgb(h); if (!rgb) return; const up = rgbToHex(rgb); setHsv(rgbToHsv(rgb)); setHexText(up); emit(up); };
  const finish = () => { setOpen(false); pushRecent(lastEmitted.current); setRecent(readRecent()); };

  const drag = (fn: (x: number, y: number, base: HSV) => HSV) => (e: RPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      setFromHsv(fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)), hsvRef.current));
    };
    move(e);
    const up = () => { el.removeEventListener('pointermove', move as any); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move as any);
    el.addEventListener('pointerup', up);
  };
  const svKeys = (e: RKeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const d = ({ ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] } as Record<string, number[]>)[e.key];
    if (!d) return; e.preventDefault();
    setFromHsv({ ...hsv, s: Math.max(0, Math.min(1, hsv.s + d[0])), v: Math.max(0, Math.min(1, hsv.v + d[1])) });
  };
  const hueKeys = (e: RKeyboardEvent) => {
    const step = e.shiftKey ? 15 : 2;
    const d = ({ ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step } as Record<string, number>)[e.key];
    if (d === undefined) return; e.preventDefault();
    setFromHsv({ ...hsv, h: (hsv.h + d + 360) % 360 });
  };

  const current = rgbToHex(hsvToRgb(hsv));
  const rgb = hsvToRgb(hsv);
  const ratio = contrastOnWhite(current);
  const level = ratio >= 4.5 ? { cls: 'ok', text: 'Readable as small text' } : ratio >= 3 ? { cls: 'warn', text: 'Fine for bars, light for small text' } : { cls: 'crit', text: 'Too light for text on white' };
  const hasEyeDropper = typeof window !== 'undefined' && 'EyeDropper' in window;

  return (
    <div className="cp" ref={root}>
      <button type="button" className="cp-trigger" disabled={disabled} aria-expanded={open} aria-haspopup="dialog" aria-label={`${label}: ${value}`} onClick={() => (open ? finish() : setOpen(true))}>
        <span className="cp-chip" style={{ background: value }} />
        <span className="hex">{value}</span><span className="sp" />
        <span className={'ratio'} style={{ color: `var(--${level.cls})` }}>{ratio.toFixed(1)}:1</span>
      </button>
      {open && (
        <div className="cp-pop" role="dialog" aria-label={label}>
          <div className="cp-sv" role="slider" tabIndex={0} aria-label="Saturation and brightness" aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
            style={{ backgroundColor: `hsl(${hsv.h},100%,50%)` }} onKeyDown={svKeys}
            onPointerDown={drag((x, y, base) => ({ ...base, s: x, v: 1 - y }))}>
            <span className="cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: current }} />
          </div>
          <div className="cp-row">
            <div className="cp-hue" role="slider" tabIndex={0} aria-label="Hue" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)} onKeyDown={hueKeys}
              onPointerDown={drag((x, _y, base) => ({ ...base, h: Math.min(359.9, x * 360) }))}>
              <span className="cp-knob" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h},100%,50%)` }} />
            </div>
            {hasEyeDropper && <button type="button" className="cp-eye" title="Pick a colour from the screen" aria-label="Pick a colour from the screen" onClick={async () => {
              try { const r = await new (window as any).EyeDropper().open(); if (r?.sRGBHex) setFromHex(r.sRGBHex); } catch { /* cancelled or blocked */ }
            }}>{EyeIcon}</button>}
          </div>
          <div className="cp-fields">
            <label>HEX<input className="inp" value={hexText} maxLength={7} spellCheck={false} aria-label="Hex colour"
              onChange={e => { const v = e.target.value.startsWith('#') ? e.target.value : '#' + e.target.value; setHexText(v.toUpperCase()); if (/^#[0-9a-f]{6}$/i.test(v)) setFromHex(v); }}
              onBlur={() => setHexText(current)} /></label>
            {(['r', 'g', 'b'] as const).map(k => (
              <label key={k}>{k.toUpperCase()}<input className="inp" type="number" min={0} max={255} value={Math.round(rgb[k])} aria-label={`${k.toUpperCase()} channel`}
                onChange={e => { const n = Math.max(0, Math.min(255, parseInt(e.target.value, 10) || 0)); setFromHex(rgbToHex({ ...rgb, [k]: n })); }} /></label>
            ))}
          </div>
          <div className="cp-sec"><span className="t">Presets</span>
            <div className="cp-grid">{PRESETS.map(p => <button type="button" key={p.hex} className={'cp-sw' + (p.hex === current ? ' on' : '')} style={{ background: p.hex }} title={`${p.name} ${p.hex}`} aria-label={`Use ${p.hex}`} onClick={() => setFromHex(p.hex)} />)}</div>
          </div>
          {recent.length > 0 && (
            <div className="cp-sec"><span className="t">Recent</span>
              <div className="cp-grid">{recent.map(h => <button type="button" key={h} className={'cp-sw' + (h.toUpperCase() === current ? ' on' : '')} style={{ background: h }} title={h} aria-label={`Use recent ${h}`} onClick={() => setFromHex(h)} />)}</div>
            </div>
          )}
          <div className="cp-check" aria-live="polite">
            <div className="cp-demo"><span className="bar" style={{ background: current }} /><span style={{ color: current }}>IR-2026-042</span><em><span style={{ color: current, fontFamily: 'var(--f-mono)', fontSize: 11, marginRight: 6 }}>01</span>Executive summary</em></div>
            <div className="ln"><span style={{ color: `var(--${level.cls})` }}>{level.text}</span><b>{ratio.toFixed(2)}:1</b></div>
            {ratio < 4.5 && <button type="button" className="btn sm" onClick={() => setFromHex(darkenTo(current, 4.5))}>Darken to 4.5:1</button>}
          </div>
        </div>
      )}
    </div>
  );
}
