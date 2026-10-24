import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { type Graph, diff, edgeKey, fmtDate, fmtSla, plural, TYPE_LABEL, DIFF_FIELDS, NODE_W, NODE_H, GAP_X, GAP_Y, EMPTY_GRAPH } from '@muster/core';
import { api } from '@muster/backend';
import { useLoad, useChanges, useMe, can, useToast, Loading, ErrorState, go, useNames } from '../lib';
import { StaticGraph, bbox } from '../graph';
import { PlaybookHeader } from './Editor';

export function PlaybookHistory({ id }: { id: string }) {
  const me = useMe();
  const N = useNames();
  const toast = useToast();
  const { data: pb, error, reload } = useLoad(() => api.playbook(id), [id]);
  useChanges(c => { if (c.type === 'playbook' && c.id === id) reload(); });
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);

  const vs = pb?.versions || [];
  const live = vs[vs.length - 1];
  const pending = pb ? diff(live ? live.graph : EMPTY_GRAPH, pb.draft).count : 0;
  useEffect(() => {
    if (!pb || b !== null) return;
    const bb = pending || !live ? 'draft' : String(live.v);
    setB(bb);
    setA(bb === 'draft' ? (live ? String(live.v) : 'none') : vs.length > 1 ? String(vs[vs.length - 2].v) : 'none');
  }, [pb]);  // eslint-disable-line react-hooks/exhaustive-deps

  const snap = (k: string | null): Graph => {
    if (!pb || !k || k === 'none') return EMPTY_GRAPH;
    if (k === 'draft') return pb.draft;
    return vs.find(v => String(v.v) === k)?.graph || EMPTY_GRAPH;
  };
  const A = snap(a), B = snap(b);
  const d = useMemo(() => diff(A, B), [A, B]);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!pb || b === null) return <Loading label="Loading history" />;

  const pick = (k: string) => {
    setB(k);
    if (k === 'draft') setA(live ? String(live.v) : 'none');
    else { const i = vs.findIndex(v => String(v.v) === k); setA(i > 0 ? String(vs[i - 1].v) : 'none'); }
  };
  const keys = ['none', ...vs.map(v => String(v.v)), 'draft'];
  const keyLabel = (k: string) => k === 'none' ? 'Empty' : k === 'draft' ? 'Draft' : 'v' + k;

  // Union graph: target version plus anything removed from the base.
  const removed = new Set(d.removed), mod = new Set(d.modified.map(m => m.id)), add = new Set(d.added);
  const ug: Graph = { nodes: B.nodes.map(n => ({ ...n })), edges: [...B.edges] };
  const bb = bbox(B); let stack = 0;
  for (const n of A.nodes.filter(x => removed.has(x.id))) {
    const c = { ...n };
    if (ug.nodes.some(m => Math.abs(m.x - c.x) < NODE_W + 10 && Math.abs(m.y - c.y) < NODE_H + 10)) { c.x = bb.x + bb.w + GAP_X * 2; c.y = bb.y + stack * (NODE_H + GAP_Y / 2); stack++; }
    ug.nodes.push(c);
  }
  const eRem = new Set(d.eRemoved), eAdd = new Set(d.eAdded), eMod = new Set(d.eModified);
  for (const e of A.edges) if (eRem.has(edgeKey(e))) ug.edges.push(e);

  const am = new Map(A.nodes.map(n => [n.id, n])), bm = new Map(B.nodes.map(n => [n.id, n]));
  const tt = (nid: string) => (bm.get(nid) || am.get(nid))?.title || nid;
  const val = (k: string, v: unknown) => k === 'sla' ? (v ? fmtSla(v as number) : '—') : k === 'type' ? TYPE_LABEL[v as keyof typeof TYPE_LABEL] : (String(v ?? '') || '—');
  const ae = new Map(A.edges.map(e => [edgeKey(e), e])), be = new Map(B.edges.map(e => [edgeKey(e), e]));
  const eTitle = (k: string) => { const [x, y] = k.split('>'); return `${tt(x)} → ${tt(y)}`; };
  const restorable = b !== 'draft' && b !== 'none' && can(me, 'editor');

  return (
    <div className="frame col">
      <PlaybookHeader pb={pb} tab="history" right={live ? <span className={'tag ' + (pending ? 'warn' : 'ok')}><i />v{live.v} live{pending ? ` · ${plural(pending, 'change')}` : ''}</span> : <span className="tag warn"><i />Never published</span>} />
      <div className="hist">
        <aside className="vside">
          <div className="side-h"><h2>Versions</h2><p>Every incident runs on a frozen version.</p></div>
          <ol className="vtl">
            {(pending > 0 || !live) && (
              <li><button className={'vrow draft' + (b === 'draft' ? ' on' : '')} onClick={() => pick('draft')}>
                <span className="vnode" /><div><div className="vtop"><span className="vv">Draft</span><span className="vd">{N(pb.updatedBy)}</span></div><b>{plural(pending, 'unpublished change')}</b></div>
              </button></li>
            )}
            {vs.slice().reverse().map(v => (
              <li key={v.v}><button className={'vrow' + (v === live ? ' cur' : '') + (b === String(v.v) ? ' on' : '')} onClick={() => pick(String(v.v))}>
                <span className="vnode" /><div><div className="vtop"><span className="vv">v{v.v}</span><span className="vd">{fmtDate(v.date)}</span></div><b>{v.msg}</b><small>{N(v.author)}</small>
                  {v === live && <div className="tags"><span className="tag ok"><i />Live</span></div>}</div>
              </button></li>
            ))}
          </ol>
        </aside>
        <div className="vmain">
          <div className="cmpbar">
            <span className="lab">Compare</span>
            <select className="inp" value={a || 'none'} onChange={e => setA(e.target.value)} aria-label="Base version">{keys.map(k => <option key={k} value={k}>{keyLabel(k)}</option>)}</select>
            <span className="arrow">→</span>
            <select className="inp" value={b} onChange={e => setB(e.target.value)} aria-label="Target version">{keys.map(k => <option key={k} value={k}>{keyLabel(k)}</option>)}</select>
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {d.count === 0 ? <span className="tag line">Identical</span> : <>
                {d.added.length + d.eAdded.length > 0 && <span className="tag ok">+{d.added.length + d.eAdded.length} added</span>}
                {d.modified.length + d.eModified.length > 0 && <span className="tag warn">~{d.modified.length + d.eModified.length} changed</span>}
                {d.removed.length + d.eRemoved.length > 0 && <span className="tag crit">−{d.removed.length + d.eRemoved.length} removed</span>}
              </>}
            </span>
            <span className="sp" />
            {restorable && <button className="btn sm" onClick={async () => {
              try { await api.restore(pb.id, Number(b)); toast(`v${b} restored to the draft. Publish to make it live.`); go(`playbooks/${pb.id}`); }
              catch (e) { toast((e as Error).message, true); }
            }}>Restore v{b} to the draft</button>}
          </div>
          <div className="diffwrap static-wrap">
            <StaticGraph g={ug} label={`Changes from ${keyLabel(a || 'none')} to ${keyLabel(b)}`}
              nodeCls={n => add.has(n.id) ? 'added' : removed.has(n.id) ? 'removed' : mod.has(n.id) ? 'modified' : (d.count ? 'same' : '')}
              edgeCls={e => { const k = edgeKey(e); return eAdd.has(k) ? 'added' : eRem.has(k) ? 'removed' : eMod.has(k) ? 'modified' : (d.count ? 'same' : ''); }} />
            <div className="dlegend"><span className="tag ok"><i />Added</span><span className="tag warn"><i />Changed</span><span className="tag crit"><i />Removed</span></div>
          </div>
          <div className="changes">
            <h3>{d.count ? `${plural(d.count, 'change')} from ${keyLabel(a || 'none').toLowerCase()} to ${keyLabel(b).toLowerCase()}` : 'No differences'}</h3>
            {d.count === 0 && <p className="empty">Moving steps around the canvas is not versioned.</p>}
            {d.added.map(nid => { const n = bm.get(nid)!; return <Row key={'a' + nid} c="add" ic="+"><b>{n.title}</b> <span className="meta">added · {TYPE_LABEL[n.type]}{n.role ? ' · ' + n.role : ''}</span></Row>; })}
            {d.modified.map(m => (
              <Row key={'m' + m.id} c="mod" ic="~"><b>{tt(m.id)}</b>
                <ul>{m.f.map((f, i) => {
                  if (f.k === 'checklist') {
                    const fa = (f.from as string[]) || [], ta = (f.to as string[]) || [];
                    const plus = ta.filter(x => !fa.includes(x)), minus = fa.filter(x => !ta.includes(x));
                    if (!plus.length && !minus.length) return <li key={i}>Checklist reordered</li>;
                    return [...plus.map((x, j) => <li key={i + 'p' + j}><span className="ins">+ {x}</span></li>), ...minus.map((x, j) => <li key={i + 'm' + j}><span className="del">{x}</span></li>)];
                  }
                  if (f.k === 'desc') return <li key={i}>Instructions rewritten</li>;
                  return <li key={i}>{DIFF_FIELDS[f.k]}: <span className="del">{val(f.k, f.from)}</span> → <span className="ins">{val(f.k, f.to)}</span></li>;
                })}</ul>
              </Row>
            ))}
            {d.removed.map(nid => <Row key={'r' + nid} c="rem" ic="−"><b>{tt(nid)}</b> <span className="meta">removed</span></Row>)}
            {d.eAdded.map(k => <Row key={'ea' + k} c="add" ic="+">{eTitle(k)} <span className="meta">connection added{be.get(k)?.label ? ' · ' + be.get(k)!.label : ''}</span></Row>)}
            {d.eModified.map(k => <Row key={'em' + k} c="mod" ic="~">{eTitle(k)} <span className="meta">label</span> <span className="del">{ae.get(k)?.label || '—'}</span> → <span className="ins">{be.get(k)?.label || '—'}</span></Row>)}
            {d.eRemoved.map(k => <Row key={'er' + k} c="rem" ic="−">{eTitle(k)} <span className="meta">connection removed</span></Row>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ c, ic, children }: { c: string; ic: string; children: ReactNode }) {
  return <div className={'ch ' + c}><span className="ic">{ic}</span><div>{children}</div></div>;
}
