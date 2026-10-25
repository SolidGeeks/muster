// SPDX-License-Identifier: AGPL-3.0-or-later
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent as RPointerEvent } from 'react';
import {
  type Graph, type PNode, type NodeType, type Severity, PHASES, ROLES, TYPE_LABEL, SEVERITIES,
  validate, diff, stepCodes, layout, uid, fmtSla, plural, EMPTY_GRAPH
} from '@muster/core';
import { api, ApiError, fileLinks, type PlaybookFull } from '@muster/backend';
import { useMe, can, useChanges, useToast, Modal, Loading, ErrorState, ConfirmButton, Icon, go, copyText, useNames } from '../lib';
import { GraphContent, bbox, NODE_W as W, NODE_H as H, GAP_X, GAP_Y } from '../graph';
import { DeclareModal } from './Incidents';

type Sel = { kind: 'node' | 'edge'; id: string } | null;
const DEF_TITLE: Record<string, string> = { action: 'New action', decision: 'New question?', escalation: 'New escalation', end: 'Incident closed' };

export function PlaybookHeader({ pb, tab, right }: { pb: { id: string; code: string; name: string }; tab: 'editor' | 'history'; right?: ReactNode }) {
  return (
    <div className="subbar">
      <div className="crumb"><a href="#/playbooks">Playbooks</a><span className="code">/</span><span className="code">{pb.code}</span><h2>{pb.name}</h2></div>
      <nav className="subtabs" aria-label="Playbook views">
        <a href={`#/playbooks/${pb.id}`} aria-current={tab === 'editor' ? 'page' : undefined}>Editor</a>
        <a href={`#/playbooks/${pb.id}/history`} aria-current={tab === 'history' ? 'page' : undefined}>History</a>
      </nav>
      <span className="sp" />
      {right}
    </div>
  );
}

export function PlaybookEditor({ id }: { id: string }) {
  const me = useMe();
  const N = useNames();
  const toast = useToast();
  const readOnly = !can(me, 'editor');
  const [pb, setPb] = useState<PlaybookFull | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [g, setG] = useState<Graph>(EMPTY_GRAPH);
  const [sel, setSel] = useState<Sel>(null);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [conflict, setConflict] = useState<{ by: string; current: PlaybookFull } | null>(null);
  const [remoteChange, setRemoteChange] = useState(false);
  const [modal, setModal] = useState<null | 'publish' | 'yaml' | 'run'>(null);
  const [, force] = useState(0);
  const rev = useRef(0);
  const undo = useRef<string[]>([]);
  const redo = useRef<string[]>([]);
  const gRef = useRef(g); gRef.current = g;
  const saveTimer = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const p = await api.playbook(id);
      setPb(p); setG(p.draft); rev.current = p.rev; dirtyRef.current = false; setSaveState('saved'); setLoadErr(null); setRemoteChange(false);
    } catch (e) { setLoadErr((e as Error).message); }
  }, [id]);
  useEffect(() => { setPb(null); undo.current = []; redo.current = []; setSel(null); load(); }, [load]);

  const save = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    if (!dirtyRef.current || readOnly) return true;
    setSaveState('saving');
    const snapshot = gRef.current;
    try {
      const r = await api.saveDraft(id, snapshot, rev.current);
      rev.current = r.rev;
      if (gRef.current === snapshot) { dirtyRef.current = false; setSaveState('saved'); }
      else scheduleSave();
      setPb(p => p ? { ...p, rev: r.rev, updatedAt: r.updatedAt, updatedBy: r.updatedBy } : p);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { setConflict({ by: e.data?.current?.updatedBy || 'Someone', current: e.data.current }); setSaveState('error'); }
      else { setSaveState('error'); toast(`Draft not saved: ${(e as Error).message}`, true); }
      return false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, readOnly]);
  const scheduleSave = () => { window.clearTimeout(saveTimer.current); saveTimer.current = window.setTimeout(() => { save(); }, 700); };
  useEffect(() => () => { if (dirtyRef.current) save(); }, [save]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirtyRef.current) { save(); e.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [save]);

  useChanges(c => {
    if (c.id !== id || c.type !== 'playbook') return;
    if (c.by === me.id) return;
    if (dirtyRef.current) setRemoteChange(true);
    else load();
  });

  /** Apply a change to the draft. Pass a snapshot to record for undo, or true to record the current state. */
  const commit = useCallback((next: Graph, recordUndo: boolean | string = true) => {
    if (readOnly) return;
    if (recordUndo) {
      const s = typeof recordUndo === 'string' ? recordUndo : JSON.stringify(gRef.current);
      if (undo.current[undo.current.length - 1] !== s) { undo.current.push(s); if (undo.current.length > 100) undo.current.shift(); }
      redo.current = [];
    }
    setG(next); gRef.current = next;
    dirtyRef.current = true; setSaveState('dirty');
    scheduleSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);
  const snapshotForUndo = () => {
    const s = JSON.stringify(gRef.current);
    if (undo.current[undo.current.length - 1] !== s) { undo.current.push(s); redo.current = []; force(x => x + 1); }
  };
  const doUndo = () => {
    const cur = JSON.stringify(gRef.current);
    let s: string | undefined;
    do { s = undo.current.pop(); } while (s === cur && undo.current.length);
    if (!s || s === cur) return;
    redo.current.push(cur);
    const next = JSON.parse(s); commit(next, false); fixSel(next); toast('Undone');
  };
  const doRedo = () => {
    const s = redo.current.pop(); if (!s) return;
    undo.current.push(JSON.stringify(gRef.current));
    const next = JSON.parse(s); commit(next, false); fixSel(next); toast('Redone');
  };
  const fixSel = (next: Graph) => setSel(s => s && (s.kind === 'node' ? next.nodes : next.edges).some(x => x.id === s.id) ? s : null);

  /* ---------- graph operations ---------- */
  const live = pb?.versions[pb.versions.length - 1];
  const val = useMemo(() => validate(g), [g]);
  const pending = useMemo(() => diff(live ? live.graph : EMPTY_GRAPH, g).count, [g, live]);

  const updateNode = (nid: string, patch: Partial<PNode>, record = false) => commit({ ...g, nodes: g.nodes.map(n => n.id === nid ? { ...n, ...patch } : n) }, record);
  const link = (from: string, to: string) => {
    const a = g.nodes.find(n => n.id === from), b = g.nodes.find(n => n.id === to);
    if (from === to || !a || !b || a.type === 'end') return;
    if (b.type === 'start') return toast('Start cannot have an incoming connection');
    if (g.edges.some(e => e.from === from && e.to === to)) return toast('These steps are already connected');
    let label = '';
    if (a.type === 'decision') { const used = g.edges.filter(e => e.from === from).map(e => e.label); label = ['Yes', 'No', 'Other'].find(l => !used.includes(l)) || ''; }
    const e = { id: uid('e_'), from, to, label };
    commit({ ...g, edges: [...g.edges, e] });
    setSel({ kind: 'edge', id: e.id });
  };
  const addNode = (type: NodeType) => {
    if (readOnly) return;
    const src = sel?.kind === 'node' ? g.nodes.find(n => n.id === sel.id) : undefined;
    const c = viewCenter();
    const n: PNode = { id: uid('n_'), type, title: DEF_TITLE[type], phase: src?.phase || '', role: '', sla: type === 'decision' ? 5 : type === 'end' ? 0 : 15, desc: '', checklist: [], x: Math.round(c.x - W / 2), y: Math.round(c.y - H / 2) };
    const edges = [...g.edges];
    if (src && src.type !== 'end') {
      const outs = g.edges.filter(e => e.from === src.id);
      n.x = src.x + outs.length * (W + GAP_X); n.y = src.y + H + GAP_Y;
      let label = '';
      if (src.type === 'decision') { const used = outs.map(e => e.label); label = ['Yes', 'No', 'Other'].find(l => !used.includes(l)) || ''; }
      edges.push({ id: uid('e_'), from: src.id, to: n.id, label });
    }
    commit({ nodes: [...g.nodes, n], edges });
    setSel({ kind: 'node', id: n.id });
    setTimeout(() => { const t = document.getElementById('f-title') as HTMLInputElement | null; t?.focus(); t?.select(); }, 0);
  };
  const deleteSel = () => {
    if (!sel || readOnly) return;
    if (sel.kind === 'node') {
      const n = g.nodes.find(x => x.id === sel.id);
      if (n?.type === 'start' && g.nodes.filter(x => x.type === 'start').length === 1) return toast('Every playbook needs a start');
      commit({ nodes: g.nodes.filter(x => x.id !== sel.id), edges: g.edges.filter(e => e.from !== sel.id && e.to !== sel.id) });
      toast('Step deleted. Ctrl+Z to undo');
    } else { commit({ ...g, edges: g.edges.filter(e => e.id !== sel.id) }); toast('Connection deleted'); }
    setSel(null);
  };
  const arrange = () => { if (readOnly) return; const next = layout(JSON.parse(JSON.stringify(g))); commit(next); requestAnimationFrame(() => fit(next)); toast('Canvas arranged'); };

  /* ---------- canvas view ---------- */
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const viewRef = useRef(view); viewRef.current = view;
  const [tmpPath, setTmpPath] = useState('');
  const ptr = useRef<any>(null);
  const fitted = useRef(false);
  const fit = useCallback((gg: Graph = gRef.current) => {
    const r = svgRef.current?.getBoundingClientRect(); if (!r || !r.width) return;
    const b = bbox(gg), padT = 70, pad = 56;
    const k = Math.max(.3, Math.min((r.width - pad * 2) / b.w, (r.height - padT - pad) / b.h, 1));
    setView({ k, x: (r.width - b.w * k) / 2 - b.x * k, y: padT + (r.height - padT - pad - b.h * k) / 2 - b.y * k });
  }, []);
  useEffect(() => { if (pb && !fitted.current) { fitted.current = true; requestAnimationFrame(() => fit(pb.draft)); } }, [pb, fit]);
  useEffect(() => { fitted.current = false; }, [id]);
  const zoomAt = (f: number, cx: number, cy: number) => setView(v => { const k = Math.min(2, Math.max(.25, v.k * f)); return { k, x: cx - (cx - v.x) * (k / v.k), y: cy - (cy - v.y) * (k / v.k) }; });
  const toWorld = (e: { clientX: number; clientY: number }) => { const r = svgRef.current!.getBoundingClientRect(), v = viewRef.current; return { x: (e.clientX - r.left - v.x) / v.k, y: (e.clientY - r.top - v.y) / v.k }; };
  const viewCenter = () => { const r = svgRef.current?.getBoundingClientRect(), v = viewRef.current; return r ? { x: (r.width / 2 - v.x) / v.k, y: (r.height / 2 - v.y) / v.k } : { x: 0, y: 0 }; };
  useEffect(() => {
    const el = svgRef.current; if (!el) return;
    const wheel = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [pb]);

  const onPointerDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    const t = e.target as Element;
    const h = t.closest('[data-handle]'), nEl = t.closest('[data-node]'), eEl = t.closest('[data-edge]');
    const w = toWorld(e);
    if (h && !readOnly) ptr.current = { mode: 'link', from: h.getAttribute('data-handle') };
    else if (nEl) {
      const nid = nEl.getAttribute('data-node')!; const n = gRef.current.nodes.find(x => x.id === nid)!;
      setSel({ kind: 'node', id: nid });
      ptr.current = readOnly ? null : { mode: 'drag', id: nid, dx: w.x - n.x, dy: w.y - n.y, pre: JSON.stringify(gRef.current), moved: false };
      if (readOnly) return;
    } else if (eEl) { setSel({ kind: 'edge', id: eEl.getAttribute('data-edge')! }); return; }
    else ptr.current = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: viewRef.current.x, vy: viewRef.current.y, moved: false };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: RPointerEvent) => {
    const p = ptr.current; if (!p) return;
    const w = toWorld(e);
    if (p.mode === 'drag') {
      const x = Math.round((w.x - p.dx) / 4) * 4, y = Math.round((w.y - p.dy) / 4) * 4;
      const cur = gRef.current;
      const next = { ...cur, nodes: cur.nodes.map(n => n.id === p.id ? { ...n, x, y } : n) };
      setG(next); gRef.current = next; p.moved = true;
    } else if (p.mode === 'pan') {
      if (Math.abs(e.clientX - p.sx) + Math.abs(e.clientY - p.sy) > 3) p.moved = true;
      setView(v => ({ ...v, x: p.vx + e.clientX - p.sx, y: p.vy + e.clientY - p.sy }));
    } else if (p.mode === 'link') {
      const a = gRef.current.nodes.find(n => n.id === p.from)!; const x0 = a.x + W / 2, y0 = a.y + H;
      setTmpPath(`M${x0},${y0} C${x0},${y0 + 50} ${w.x},${w.y - 50} ${w.x},${w.y}`);
    }
  };
  const onPointerUp = (e: RPointerEvent, cancel = false) => {
    const p = ptr.current; ptr.current = null; if (!p) return;
    if (p.mode === 'drag' && p.moved) commit(gRef.current, p.pre);
    if (p.mode === 'pan' && !p.moved && !cancel) setSel(null);
    if (p.mode === 'link') {
      setTmpPath('');
      if (!cancel) { const el = document.elementFromPoint(e.clientX, e.clientY); const t = el?.closest?.('[data-node]'); if (t) link(p.from, t.getAttribute('data-node')!); }
    }
  };

  /* ---------- keyboard ---------- */
  const keyRef = useRef<((e: KeyboardEvent) => void) | undefined>(undefined);
  keyRef.current = (e: KeyboardEvent) => {
    if (document.querySelector('.modal')) return;
    const inField = !!(e.target as HTMLElement).closest('input,textarea,select');
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'z' && !inField) { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
    else if (mod && k === 'y' && !inField) { e.preventDefault(); doRedo(); }
    else if (mod && k === 's') { e.preventDefault(); save(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && !inField && sel) { e.preventDefault(); deleteSel(); }
    else if (e.key === 'Escape') { if (inField) (e.target as HTMLElement).blur(); setSel(null); }
    else if (!inField && !mod && !e.altKey && !readOnly) {
      const m = ({ a: 'action', d: 'decision', e: 'escalation', f: 'end' } as Record<string, NodeType>)[k];
      if (m) { e.preventDefault(); addNode(m); } else if (k === 'l') { e.preventDefault(); arrange(); }
    }
  };
  useEffect(() => { const h = (e: KeyboardEvent) => keyRef.current?.(e); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, []);

  if (loadErr) return <ErrorState message={loadErr} onRetry={load} />;
  if (!pb) return <Loading label="Loading playbook" />;

  const nodeCls = (n: PNode) => sel?.kind === 'node' && sel.id === n.id ? 'sel' : '';
  const edgeCls = (e: { id: string }) => sel?.kind === 'edge' && sel.id === e.id ? 'sel' : '';
  const saveLabel = readOnly ? 'Read only' : saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Unsaved changes' : saveState === 'error' ? 'Not saved' : 'All changes saved';

  return (
    <div className="frame col">
      <PlaybookHeader pb={pb} tab="editor" right={<>
        <span className={'save-state' + (saveState !== 'saved' ? ' dirty' : '')} aria-live="polite">{saveLabel}</span>
        {live ? <span className={'tag ' + (pending ? 'warn' : 'ok')}><i />v{live.v} live{pending ? ` · ${plural(pending, 'change')}` : ''}</span> : <span className="tag warn"><i />Never published</span>}
        <button className="btn ghost sm" onClick={() => setModal('yaml')}>YAML</button>
        {can(me, 'analyst') && live && <button className="btn sm" onClick={() => setModal('run')}>Run</button>}
        {!readOnly && <button className="btn primary sm" disabled={!pending} onClick={async () => { if (await save()) setModal('publish'); }}>Publish v{(live?.v || 0) + 1}</button>}
      </>} />
      {conflict && (
        <div className="info-banner" style={{ borderRadius: 0, borderWidth: '0 0 1px' }} role="alert">
          <span>{N(conflict.by)} saved a newer version of this draft while you were editing.</span>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="btn sm" onClick={() => { setConflict(null); load(); }}>Load their version</button>
            <button className="btn sm" onClick={() => { rev.current = conflict.current.rev; setConflict(null); dirtyRef.current = true; save(); }}>Keep mine</button>
          </span>
        </div>
      )}
      {remoteChange && !conflict && (
        <div className="info-banner" style={{ borderRadius: 0, borderWidth: '0 0 1px' }}>
          <span>Someone else changed this draft. Your next save will ask which version to keep.</span>
          <button className="btn sm" onClick={() => { setRemoteChange(false); load(); }}>Discard mine and reload</button>
        </div>
      )}
      <div className="editor" style={{ flex: 1, minHeight: 0 }}>
        <div className="canvas" ref={wrapRef} style={{ backgroundSize: `${24 * view.k}px ${24 * view.k}px`, backgroundPosition: `${view.x}px ${view.y}px` }}>
          <svg ref={svgRef} className={'ed' + (readOnly ? '' : ' editing')} aria-label="Playbook editor canvas"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={e => onPointerUp(e)} onPointerCancel={e => onPointerUp(e, true)}>
            <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
              <GraphContent g={g} nodeCls={nodeCls} edgeCls={edgeCls} issues={val.issues} handles={!readOnly} />
              <path className="tmp" d={tmpPath} />
            </g>
          </svg>
          {!readOnly && (
            <div className="ctool">
              <div className="tgroup">
                <button onClick={() => addNode('action')} title="Add action (A)"><svg className="glyph" viewBox="0 0 16 16"><rect x="1.5" y="4" width="13" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg>Action<span className="kbd">A</span></button>
                <button onClick={() => addNode('decision')} title="Add decision (D)"><svg className="glyph" viewBox="0 0 16 16"><path d="M4 4 H12 L15 8 L12 12 H4 L1 8 Z" fill="currentColor" /></svg>Decision<span className="kbd">D</span></button>
                <button onClick={() => addNode('escalation')} title="Add escalation (E)"><svg className="glyph" viewBox="0 0 16 16"><rect x="1.5" y="4" width="13" height="8" rx="1.5" fill="var(--crit-wash)" stroke="var(--crit)" strokeWidth="1.3" /></svg>Escalation<span className="kbd">E</span></button>
                <button onClick={() => addNode('end')} title="Add end (F)"><svg className="glyph" viewBox="0 0 16 16"><rect x="1.5" y="4" width="13" height="8" rx="4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>End<span className="kbd">F</span></button>
              </div>
              <div className="tgroup">
                <button onClick={doUndo} disabled={!undo.current.length} title="Undo (Ctrl+Z)" aria-label="Undo"><svg className="glyph" viewBox="0 0 16 16"><path d="M5.5 3.5 L2.5 6.5 L5.5 9.5 M3 6.5 H10 a3.5 3.5 0 0 1 0 7 H7" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg></button>
                <button onClick={doRedo} disabled={!redo.current.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><svg className="glyph" viewBox="0 0 16 16"><path d="M10.5 3.5 L13.5 6.5 L10.5 9.5 M13 6.5 H6 a3.5 3.5 0 0 0 0 7 H9" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg></button>
                <span className="sep" />
                <button onClick={arrange} title="Arrange (L)">Arrange</button>
              </div>
            </div>
          )}
          {readOnly && <span className="tag line readonly-note">View only. Editors can change this playbook.</span>}
          <button className="valchip" onClick={() => { setSel(null); setTimeout(() => document.getElementById('checksGrp')?.scrollIntoView({ behavior: 'smooth' }), 0); }}>
            <span className="s" style={{ color: val.errors ? 'var(--crit)' : 'var(--ok)' }}><i />{val.errors ? plural(val.errors, 'error') : 'Ready to publish'}</span><span className="vs" />
            <span className="s" style={{ color: val.warns ? 'var(--warn)' : 'var(--muted)' }}><i />{plural(val.warns, 'warning')}</span>
          </button>
          <div className="zoom tgroup">
            <button aria-label="Zoom out" onClick={() => { const r = svgRef.current!.getBoundingClientRect(); zoomAt(1 / 1.2, r.width / 2, r.height / 2); }}><svg className="glyph" viewBox="0 0 16 16"><path d="M3.5 8 H12.5" stroke="currentColor" strokeWidth="1.5" /></svg></button>
            <span className="pct">{Math.round(view.k * 100)}%</span>
            <button aria-label="Zoom in" onClick={() => { const r = svgRef.current!.getBoundingClientRect(); zoomAt(1.2, r.width / 2, r.height / 2); }}><svg className="glyph" viewBox="0 0 16 16"><path d="M3.5 8 H12.5 M8 3.5 V12.5" stroke="currentColor" strokeWidth="1.5" /></svg></button>
            <span className="sep" />
            <button onClick={() => fit()}>Fit</button>
          </div>
        </div>
        <Inspector pb={pb} setPb={setPb} g={g} sel={sel} setSel={setSel} readOnly={readOnly} val={val}
          updateNode={updateNode} commit={commit} snapshot={snapshotForUndo} deleteSel={deleteSel} />
      </div>
      {modal === 'publish' && <PublishModal pb={pb} g={g} onClose={() => setModal(null)} onPublished={p => { setPb(p); setModal(null); toast(`Version ${p.versions.length ? p.versions[p.versions.length - 1].v : ''} is live`); }} />}
      {modal === 'yaml' && <YamlModal pb={pb} onClose={() => setModal(null)} />}
      {modal === 'run' && <DeclareModal playbookId={pb.id} onClose={() => setModal(null)} />}
    </div>
  );
}

function Inspector({ pb, setPb, g, sel, setSel, readOnly, val, updateNode, commit, snapshot, deleteSel }: {
  pb: PlaybookFull; setPb: (p: PlaybookFull) => void; g: Graph; sel: Sel; setSel: (s: Sel) => void; readOnly: boolean; val: ReturnType<typeof validate>;
  updateNode: (id: string, patch: Partial<PNode>, record?: boolean) => void; commit: (g: Graph, rec?: boolean | string) => void; snapshot: () => void; deleteSel: () => void;
}) {
  const me = useMe();
  const N = useNames();
  const toast = useToast();
  const codes = useMemo(() => stepCodes(g), [g]);
  const ro = readOnly;

  if (sel?.kind === 'node') {
    const n = g.nodes.find(x => x.id === sel.id);
    if (!n) return <aside className="inspector" />;
    const outs = g.edges.filter(e => e.from === n.id), term = n.type === 'start' || n.type === 'end', owned = n.type === 'action' || n.type === 'escalation';
    const setEdgeLabel = (eid: string, label: string) => commit({ ...g, edges: g.edges.map(e => e.id === eid ? { ...e, label } : e) }, false);
    return (
      <aside className="inspector" aria-label="Step details">
        <div className="ins-head"><div><div className="ins-code">{codes[n.id]}</div><div className="ins-kind"><b>{TYPE_LABEL[n.type]}</b>{n.phase ? ' · ' + n.phase : ''}</div></div><span className="sp" />
          {!ro && <button className="btn sm danger" onClick={deleteSel}>Delete</button>}</div>
        <section className="grp">
          <label className="field">Title<input className="inp" id="f-title" disabled={ro} value={n.title} onFocus={snapshot} onChange={e => updateNode(n.id, { title: e.target.value })} /></label>
          <div className="row2">
            <label className="field">Type<select className="inp" disabled={ro} value={n.type} onChange={e => { const type = e.target.value as NodeType; updateNode(n.id, { type, ...(type === 'start' || type === 'end' ? { role: '', sla: 0 } : {}) }, true); }}>
              {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="field">NIST phase<select className="inp" disabled={ro} value={n.phase} onChange={e => updateNode(n.id, { phase: e.target.value }, true)}><option value="">None</option>{PHASES.map(p => <option key={p}>{p}</option>)}</select></label>
          </div>
        </section>
        {!term && (
          <section className="grp"><div className="grp-h"><h4>Ownership</h4></div>
            <div className="row2">
              <label className="field">Owner<select className="inp" disabled={ro} value={n.role} onChange={e => updateNode(n.id, { role: e.target.value }, true)}><option value="">Unassigned</option>{[...new Set([...ROLES, ...(n.role ? [n.role] : [])])].map(r => <option key={r}>{r}</option>)}</select></label>
              <label className="field">SLA<span className="suffix"><input className="inp" type="number" min={0} step={5} disabled={ro} value={n.sla} onFocus={snapshot} onChange={e => updateNode(n.id, { sla: Math.max(0, parseInt(e.target.value, 10) || 0) })} /><span>min</span></span></label>
            </div>
            <label className="field">Instructions<textarea className="inp" rows={3} disabled={ro} value={n.desc} placeholder="What the responder needs to know before acting" onFocus={snapshot} onChange={e => updateNode(n.id, { desc: e.target.value })} /></label>
          </section>
        )}
        {owned && (
          <section className="grp"><div className="grp-h"><h4>Checklist</h4><span>{plural(n.checklist.length, 'task')}</span></div>
            <ul className="cl">{n.checklist.map((c, i) => (
              <li key={i}><span className="n">{String(i + 1).padStart(2, '0')}</span>
                <input disabled={ro} value={c} aria-label={`Task ${i + 1}`} onFocus={snapshot} onChange={e => updateNode(n.id, { checklist: n.checklist.map((x, j) => j === i ? e.target.value : x) })} />
                {!ro && <button className="x" aria-label="Remove task" onClick={() => updateNode(n.id, { checklist: n.checklist.filter((_, j) => j !== i) }, true)}>{Icon.x}</button>}
              </li>))}
            </ul>
            {!ro && <button className="addrow" onClick={() => { updateNode(n.id, { checklist: [...n.checklist, ''] }, true); setTimeout(() => { const ins = document.querySelectorAll<HTMLInputElement>('.cl input'); ins[ins.length - 1]?.focus(); }, 0); }}>Add task</button>}
          </section>
        )}
        {n.type !== 'end' && (
          <section className="grp"><div className="grp-h"><h4>{n.type === 'decision' ? 'Answers' : 'Next'}</h4><span>{plural(outs.length, 'route')}</span></div>
            {outs.length ? <div className="outs">{outs.map(e => { const t = g.nodes.find(x => x.id === e.to); return (
              <div className="o" key={e.id}>
                <input className="inp" disabled={ro} value={e.label} placeholder={n.type === 'decision' ? 'Label' : '—'} aria-label="Connection label" onFocus={snapshot} onChange={ev => setEdgeLabel(e.id, ev.target.value)} />
                <span className="to"><b>{codes[e.to]}</b>{t?.title}</span>
                {!ro && <button className="x" aria-label="Remove connection" onClick={() => commit({ ...g, edges: g.edges.filter(x => x.id !== e.id) })}>{Icon.x}</button>}
              </div>); })}</div>
              : <p className="empty" style={{ fontSize: 13 }}>{ro ? 'No route.' : 'No route yet. Drag the handle under the step onto another step.'}</p>}
          </section>
        )}
      </aside>
    );
  }

  if (sel?.kind === 'edge') {
    const e = g.edges.find(x => x.id === sel.id);
    if (!e) return <aside className="inspector" />;
    const a = g.nodes.find(n => n.id === e.from)!, b = g.nodes.find(n => n.id === e.to)!;
    return (
      <aside className="inspector" aria-label="Connection details">
        <div className="ins-head"><div><div className="ins-code">{codes[a.id]} → {codes[b.id]}</div><div className="ins-kind"><b>Connection</b></div></div><span className="sp" />{!ro && <button className="btn sm danger" onClick={deleteSel}>Delete</button>}</div>
        <section className="grp">
          <div className="field">From<div style={{ font: '550 14px var(--f-ui)', color: 'var(--ink)' }}>{a.title}</div></div>
          <div className="field">To<div style={{ font: '550 14px var(--f-ui)', color: 'var(--ink)' }}>{b.title}</div></div>
          <label className="field">Label{a.type === 'decision' ? ' (answer)' : ''}<input className="inp" disabled={ro} value={e.label} placeholder={a.type === 'decision' ? 'Yes, No…' : 'Optional'} onFocus={snapshot} onChange={ev => commit({ ...g, edges: g.edges.map(x => x.id === e.id ? { ...x, label: ev.target.value } : x) }, false)} /></label>
        </section>
      </aside>
    );
  }

  const phases = new Set(g.nodes.map(n => n.phase).filter(Boolean));
  const steps = g.nodes.filter(n => n.type !== 'start' && n.type !== 'end');
  const tot = steps.reduce((a, n) => a + (+n.sla || 0), 0);
  const saveMeta = async (patch: Partial<Pick<PlaybookFull, 'name' | 'category' | 'severity' | 'description'>>) => {
    try { const p = await api.updatePlaybook(pb.id, patch); setPb({ ...pb, ...patch, updatedAt: p.updatedAt, updatedBy: p.updatedBy }); }
    catch (err) { toast((err as Error).message, true); }
  };
  return (
    <aside className="inspector" aria-label="Playbook details">
      <div className="ins-head" style={{ flexDirection: 'column', gap: 6 }}>
        <span className="code">{pb.code} · Playbook</span>
        <MetaInput className="pbname" value={pb.name} disabled={ro} label="Playbook name" onSave={v => v.trim() && saveMeta({ name: v.trim() })} />
      </div>
      <section className="grp">
        <div className="row2">
          <label className="field">Category<MetaInput className="inp" value={pb.category} disabled={ro} label="Category" onSave={v => v.trim() && saveMeta({ category: v.trim() })} /></label>
          <label className="field">Default severity<select className="inp" disabled={ro} value={pb.severity} onChange={e => saveMeta({ severity: e.target.value as Severity })}>{SEVERITIES.map(s => <option key={s}>{s}</option>)}</select></label>
        </div>
        <label className="field">When to use it<MetaInput area className="inp" value={pb.description} disabled={ro} label="Description" onSave={v => saveMeta({ description: v.trim() })} /></label>
      </section>
      <section className="grp"><div className="stats"><div className="stat"><b>{steps.length}</b><span>Steps</span></div><div className="stat"><b>{phases.size}/5</b><span>Phases</span></div><div className="stat"><b>{fmtSla(tot)}</b><span>Total SLA</span></div></div></section>
      <section className="grp" id="checksGrp"><div className="grp-h"><h4>Checks</h4><span>{val.errors} err · {val.warns} warn</span></div>
        {val.list.length ? <ul className="checks-list">{val.list.map((c, i) => <li key={i}><button onClick={() => c.id && setSel({ kind: 'node', id: c.id })}><span className={'lvl ' + c.lvl}>{c.lvl === 'err' ? 'ERROR' : 'WARN'}</span><span>{c.msg}</span></button></li>)}</ul> : <div className="allgood">All checks pass</div>}
        {val.errors > 0 && <p className="foot">Errors block publishing. Warnings don't.</p>}
      </section>
      <section className="grp"><div className="grp-h"><h4>Notation</h4></div>
        <div className="notation">
          <div><svg viewBox="0 0 28 16"><rect x="1" y="2" width="26" height="12" rx="2" fill="var(--card)" stroke="var(--rule-strong)" /></svg>Action</div>
          <div><svg viewBox="0 0 28 16"><path d="M6 2 H22 L27 8 L22 14 H6 L1 8 Z" fill="var(--ink)" /></svg>Decision</div>
          <div><svg viewBox="0 0 28 16"><rect x="1" y="2" width="26" height="12" rx="2" fill="var(--crit-wash)" stroke="var(--crit)" strokeWidth="1.5" /></svg>Escalation</div>
          <div><svg viewBox="0 0 28 16"><rect x="1" y="2" width="26" height="12" rx="6" fill="var(--card)" stroke="var(--ink)" strokeWidth="1.5" /></svg>Start / end</div>
        </div>
        <p className="foot">The five marks on each step show its NIST phase, from Detection to Lessons learned.</p></section>
      {!ro && (
        <section className="grp"><div className="grp-h"><h4>Shortcuts</h4></div>
          <div className="shortcuts">
            <span><span className="kbd">A</span><span className="kbd">D</span><span className="kbd">E</span><span className="kbd">F</span></span><span>Add a step after the selection</span>
            <span><span className="kbd">L</span></span><span>Arrange the canvas</span>
            <span><span className="kbd">Del</span></span><span>Delete the selection</span>
            <span><span className="kbd">Ctrl</span><span className="kbd">Z</span></span><span>Undo · add Shift to redo</span>
            <span><span className="kbd">Ctrl</span><span className="kbd">S</span></span><span>Save the draft now</span>
          </div></section>
      )}
      <section className="grp"><p className="foot">Draft last saved by {N(pb.updatedBy)}. Drafts save automatically; publishing makes them the version incidents run on.</p>
        {can(me, 'admin') && <div><ConfirmButton label="Archive playbook" confirmLabel="Click again to archive" onConfirm={async () => { try { await api.archivePlaybook(pb.id); toast(`${pb.code} archived`); go('playbooks'); } catch (e) { toast((e as Error).message, true); } }} /></div>}
      </section>
    </aside>
  );
}

/** Text input that saves on blur or Enter, not on every keystroke. */
function MetaInput({ value, onSave, disabled, className, label, area }: { value: string; onSave: (v: string) => void; disabled?: boolean; className?: string; label: string; area?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const done = () => { if (v !== value) onSave(v); };
  if (area) return <textarea className={className} rows={2} value={v} disabled={disabled} aria-label={label} onChange={e => setV(e.target.value)} onBlur={done} />;
  return <input className={className} value={v} disabled={disabled} aria-label={label} onChange={e => setV(e.target.value)} onBlur={done} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

function PublishModal({ pb, g, onClose, onPublished }: { pb: PlaybookFull; g: Graph; onClose: () => void; onPublished: (p: PlaybookFull) => void }) {
  const live = pb.versions[pb.versions.length - 1];
  const next = (live?.v || 0) + 1;
  const d = diff(live ? live.graph : EMPTY_GRAPH, g);
  const v = validate(g);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const a = d.added.length + d.eAdded.length, r = d.removed.length + d.eRemoved.length, m = d.modified.length + d.eModified.length;
  return (
    <Modal kicker={`${pb.code} · ${pb.name}`} title={`Publish version ${next}`} onClose={onClose}
      actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!!v.errors || busy} onClick={async () => {
        setBusy(true); setErr(null);
        try { onPublished(await api.publish(pb.id, msg)); } catch (e) { setErr((e as Error).message); setBusy(false); }
      }}>{busy ? 'Publishing…' : `Publish v${next}`}</button></>}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {a > 0 && <span className="tag ok">+{a} added</span>}{m > 0 && <span className="tag warn">~{m} changed</span>}{r > 0 && <span className="tag crit">−{r} removed</span>}
      </div>
      {v.errors > 0 && <div className="errbox"><b>Fix {plural(v.errors, 'error')} before publishing.</b><ul>{v.list.filter(c => c.lvl === 'err').map((c, i) => <li key={i}>{c.msg}</li>)}</ul></div>}
      {err && <div className="errbox">{err}</div>}
      <label className="field">Release note<textarea className="inp" rows={3} value={msg} onChange={e => setMsg(e.target.value)} placeholder="e.g. Shorter isolation SLA after the October exercise" /></label>
      <p className="foot">v{next} becomes the default for new incidents. Incidents already running stay on the version they started with.</p>
    </Modal>
  );
}

function YamlModal({ pb, onClose }: { pb: PlaybookFull; onClose: () => void }) {
  const toast = useToast();
  const [y, setY] = useState<string | null>(null);
  useEffect(() => { api.yaml(pb.id).then(setY).catch(e => setY('# ' + (e as Error).message)); }, [pb.id]);
  return (
    <Modal wide kicker={`${pb.code} · draft`} title={`${pb.name}.yaml`} onClose={onClose}
      actions={<>{fileLinks('playbook', pb.id).yaml && <a className="btn" href={fileLinks('playbook', pb.id).yaml} download>{Icon.download}Download</a>}<button className="btn primary" disabled={!y} onClick={async () => toast(await copyText(y || '') ? 'YAML copied' : 'Copy failed. Select the text instead.', false)}>Copy YAML</button></>}>
      <pre className="yaml">{y ?? 'Loading…'}</pre>
    </Modal>
  );
}
