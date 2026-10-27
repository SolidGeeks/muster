// SPDX-License-Identifier: AGPL-3.0-or-later
// Link to Strata, the map of the information systems. An incident can name a Strata IS, the assets it starts
// from and parameters (a CVE…); Strata opens it on its map, runs the playbook there and reports back the state of
// the assets and what it did. A playbook step names what it acts on through `targets` selectors, which Strata
// resolves on its map; a decision can mark assets through `effects`.
import type { PNode, StrataLink, StrataState, Incident, LogKind } from './types';
import { clockNow } from './incident';

export const STRATA_STATES: StrataState[] = ['compromised', 'suspected', 'contained'];
// affected, compromised, id:<asset>, type:<type>, role:<text>, vuln:<CVE or {param}>, exposed:internet,
// reach:<selector>, consumers:<selector>, flows:<selector>, business:<selector>, contacts:<selector>, contacts:is
const BASE = /^(affected|compromised|suspected|contained|exposed:internet|contacts:is|(id|type|role|vuln):[^\n]{1,120})$/;
const WRAP = /^(reach|consumers|flows|business|contacts):(.+)$/;
export function isSelector(s: unknown): boolean {
  if (typeof s !== 'string' || s.length > 160) return false;
  if (BASE.test(s)) return true;
  const m = WRAP.exec(s);
  return !!m && isSelector(m[2]);
}
/** An error message for the targets and effects of a step, or null when they are fine (both are optional). */
export function checkTargets(n: PNode): string | null {
  if (n.targets !== undefined) {
    if (!Array.isArray(n.targets) || n.targets.length > 12) return `Invalid targets on ${n.id}`;
    const bad = n.targets.find(t => !isSelector(t));
    if (bad !== undefined) return `Unknown target "${String(bad).slice(0, 40)}" on ${n.id}`;
  }
  if (n.effects !== undefined) {
    if (!n.effects || typeof n.effects !== 'object' || Array.isArray(n.effects)) return `Invalid effects on ${n.id}`;
    for (const [label, e] of Object.entries(n.effects)) {
      if (label.length > 60 || !Array.isArray(e) || e.length !== 2 || !STRATA_STATES.includes(e[0]) || !isSelector(e[1])) return `Invalid effect "${label.slice(0, 40)}" on ${n.id}`;
    }
  }
  return null;
}
const ID = /^[A-Za-z0-9_.:@+~-]{1,120}$/;
const str = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : '';
/** A clean link from what a form or Strata sent. Throws with a message for the user on anything wrong. */
export function cleanStrata(v: unknown, prev?: StrataLink | null): StrataLink | null {
  if (v === undefined) return prev ?? null;
  if (v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new Error('The Strata link must be an object');
  const b = v as Record<string, unknown>;
  const site = b.site !== undefined ? str(b.site, 120) : prev?.site || '';
  if (site && !ID.test(site)) throw new Error('The Strata IS id may hold letters, digits and . _ : @ + ~ - only');
  const list = (x: unknown) => (Array.isArray(x) ? x : typeof x === 'string' ? x.split(/[,\n]/) : []).map(s => str(s, 120)).filter(Boolean);
  const assets = b.assets !== undefined ? [...new Set(list(b.assets))].slice(0, 200) : prev?.assets || [];
  const params: Record<string, string> = { ...(prev?.params || {}) };
  if (b.params !== undefined) {
    for (const k of Object.keys(params)) delete params[k];
    if (b.params && typeof b.params === 'object' && !Array.isArray(b.params))
      for (const [k, x] of Object.entries(b.params as Record<string, unknown>)) { if (/^\w{1,30}$/.test(k) && str(x, 120)) params[k] = str(x, 120); }
  }
  const marks: Record<string, StrataState> = { ...(prev?.marks || {}) };
  if (b.marks !== undefined) {
    for (const k of Object.keys(marks)) delete marks[k];
    if (b.marks && typeof b.marks === 'object') for (const [k, x] of Object.entries(b.marks as Record<string, unknown>)) {
      if (ID.test(k) && STRATA_STATES.includes(x as StrataState) && Object.keys(marks).length < 500) marks[k] = x as StrataState;
    }
  }
  const names: Record<string, string> = { ...(prev?.names || {}) };
  if (b.names && typeof b.names === 'object') for (const [k, x] of Object.entries(b.names as Record<string, unknown>)) { if (ID.test(k) && str(x, 120) && Object.keys(names).length < 500) names[k] = str(x, 120); }
  if (!site && !assets.length && !Object.keys(params).length && !Object.keys(marks).length) return null;
  return { site, assets, params, marks, names };
}
/** An entry Strata adds to the timeline: what it marked, cut or decided on the map. */
export function strataLog(inc: Incident, msg: string, kind: LogKind, by: string, now = Date.now()): void {
  const t = inc.status === 'active' ? clockNow(inc.clock, now) : (inc.endedAt ?? clockNow(inc.clock, now));
  inc.log.push({ t, msg: `Strata: ${msg}`.slice(0, 500), kind, by });
}
