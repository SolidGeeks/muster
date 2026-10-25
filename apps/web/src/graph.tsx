// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ReactElement } from 'react';
import type { Graph, PNode, PEdge } from '@muster/core';
import { NODE_W as W, NODE_H as H, GAP_X, GAP_Y, PHASES, TYPE_LABEL, stepCodes, fmtSla } from '@muster/core';

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

export function markerFor(c: string) {
  if (/\b(sel|taken)\b/.test(c)) return 'arr-acc';
  if (/\badded\b/.test(c)) return 'arr-ok';
  if (/\bremoved\b/.test(c)) return 'arr-crit';
  if (/\bmodified\b/.test(c)) return 'arr-warn';
  return 'arr-def';
}

export function route(a: PNode, b: PNode) {
  const x0 = a.x + W / 2, y0 = a.y + H, x1 = b.x + W / 2, y1 = b.y;
  if (y1 < y0 + 24) { const dy = 70; return { d: `M${x0},${y0} C${x0},${y0 + dy} ${x1},${y1 - dy} ${x1},${y1}`, lx: (x0 + x1) / 2, ly: (y0 + y1) / 2 }; }
  if (Math.abs(x1 - x0) < 2) return { d: `M${x0},${y0} V${y1}`, lx: x0, ly: y0 + Math.min(30, (y1 - y0) / 2) };
  const span = y1 - y0, my = span > H + GAP_Y + 10 ? y1 - 30 : y0 + 30, r = Math.min(10, Math.abs(x1 - x0) / 2), s = x1 > x0 ? 1 : -1;
  return { d: `M${x0},${y0} V${my - r} Q${x0},${my} ${x0 + s * r},${my} H${x1 - s * r} Q${x1},${my} ${x1},${my + r} V${y1}`, lx: (x0 + x1) / 2, ly: my };
}

export interface GraphOpts {
  nodeCls?: (n: PNode) => string;
  edgeCls?: (e: PEdge) => string;
  issues?: Record<string, 'err' | 'warn'>;
  handles?: boolean;
}

/** SVG content for a playbook graph: edges, then labels, then nodes. */
export function GraphContent({ g, nodeCls = () => '', edgeCls = () => '', issues = {}, handles = false }: GraphOpts & { g: Graph }) {
  const codes = stepCodes(g);
  const by = new Map(g.nodes.map(n => [n.id, n]));
  const edges: ReactElement[] = [], labels: ReactElement[] = [], nodes: ReactElement[] = [];
  for (const e of g.edges) {
    const a = by.get(e.from), b = by.get(e.to);
    if (!a || !b) continue;
    const r = route(a, b), c = edgeCls(e);
    edges.push(<g key={e.id} className={'edge ' + c} data-edge={e.id}><path className="hit" d={r.d} /><path className="line" d={r.d} markerEnd={`url(#${markerFor(c)})`} /></g>);
    if (e.label) {
      const t = e.label.toUpperCase(), lw = t.length * 6.6 + 14;
      labels.push(<g key={e.id} className={'edge ' + c} data-edge={e.id}><g className="elabel" transform={`translate(${r.lx},${r.ly})`}><rect x={-lw / 2} y={-9} width={lw} height={18} rx={2} /><text textAnchor="middle" y={3.3}>{t}</text></g></g>);
    }
  }
  for (const n of g.nodes) {
    const t = n.type, term = t === 'start' || t === 'end';
    const c = nodeCls(n);
    let shape: ReactElement, halo: ReactElement;
    if (t === 'decision') {
      const p = `M20,0 H${W - 20} L${W},${H / 2} L${W - 20},${H} H20 L0,${H / 2} Z`;
      shape = <path className="shape" d={p} />; halo = <path className="halo" d={p} />;
    } else {
      const rx = term ? H / 2 : 4;
      shape = <rect className="shape" width={W} height={H} rx={rx} />;
      halo = <rect className="halo" x={-1} y={-1} width={W + 2} height={H + 2} rx={rx + 1} />;
    }
    const px = t === 'decision' || term ? 28 : 14;
    const meta = term ? '' : [n.role, n.sla ? fmtSla(n.sla) : ''].filter(Boolean).join('  ·  ');
    const pi = PHASES.indexOf(n.phase as typeof PHASES[number]);
    const kind = term ? TYPE_LABEL[t].toUpperCase() : codes[n.id] + (t === 'escalation' ? '  ESCALATION' : t === 'decision' ? '  DECISION' : '');
    const iss = issues[n.id];
    nodes.push(
      <g key={n.id} className={`node t-${t} ${c}`} data-node={n.id} transform={`translate(${n.x},${n.y})`}>
        {halo}{shape}
        <text className="sc" x={px} y={term ? 31 : 21}>{kind}</text>
        {!term && <g className="ph" transform={`translate(${W - px - 38},15)`}>{PHASES.map((_, i) => <rect key={i} x={i * 8} width={6} height={3} className={i === pi ? 'on' : ''} />)}</g>}
        <text className="ti" x={px} y={term ? 50 : 43}>{trunc(n.title || 'Untitled', t === 'decision' ? 22 : 26)}</text>
        {meta && <text className="me" x={px} y={61}>{trunc(meta, 34)}</text>}
        {iss && <g className={'issue ' + iss} transform={`translate(${t === 'decision' ? W - 26 : W - 6},${t === 'decision' ? 6 : -6})`}><rect x={-8} y={-8} width={16} height={16} rx={2} /><text textAnchor="middle" y={3.4}>!</text></g>}
        {handles && t !== 'end' && <circle className="handle" data-handle={n.id} cx={W / 2} cy={H} r={6.5} />}
        <title>{n.title}</title>
      </g>
    );
  }
  return <><g>{edges}</g><g>{labels}</g><g>{nodes}</g></>;
}

export function bbox(g: Graph) {
  if (!g.nodes.length) return { x: -200, y: -100, w: 400, h: 200 };
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const n of g.nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + W); y1 = Math.max(y1, n.y + H); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function StaticGraph({ g, pad = 44, label, ...opts }: GraphOpts & { g: Graph; pad?: number; label?: string }) {
  const b = bbox(g);
  return (
    <svg className="static" viewBox={`${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`} role="img" aria-label={label || 'Playbook diagram'}>
      <GraphContent g={g} {...opts} />
    </svg>
  );
}

export { W as NODE_W, H as NODE_H, GAP_X, GAP_Y };
