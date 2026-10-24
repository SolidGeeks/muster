import { useEffect, useRef, useState } from 'react';
import { PHASES, SEVERITIES, stepCodes, fmtClock, fmtDur, fmtSla, fmtT, plural, LOG_LABEL, clockNow, type Severity } from '@muster/core';
import { api, ApiError, type IncidentFull } from '@muster/backend';
import { useMe, can, useChanges, useToast, Loading, ErrorState, ConfirmButton, Icon, go, useNow, useNames } from '../lib';
import { StaticGraph } from '../graph';

export function IncidentRun({ id }: { id: string }) {
  const me = useMe();
  const N = useNames();
  const toast = useToast();
  const canRun = can(me, 'analyst');
  const [inc, setInc] = useState<IncidentFull | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const offset = useRef(0); // server clock minus local clock
  const now = useNow(250);

  const apply = (x: IncidentFull) => { offset.current = x.serverNow - Date.now(); setInc(x); };
  const load = async () => { try { apply(await api.incident(id)); setErr(null); } catch (e) { setErr((e as Error).message); } };
  useEffect(() => { setInc(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useChanges(c => { if (c.type === 'incident' && c.id === id) load(); });

  const act = async (fn: () => Promise<IncidentFull>, ok?: string) => {
    setBusy(true);
    try { apply(await fn()); if (ok) toast(ok); }
    catch (e) { toast((e as Error).message, true); if (e instanceof ApiError && e.status === 409) load(); }
    finally { setBusy(false); }
  };

  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!inc) return <Loading label="Loading incident" />;

  const g = inc.graph, codes = stepCodes(g);
  const t = inc.status === 'active' ? clockNow(inc.clock, now + offset.current) : (inc.endedAt ?? 0);
  const cur = inc.steps[inc.steps.length - 1];
  const n = g.nodes.find(x => x.id === cur.id)!;
  const done = inc.status !== 'active';
  const curPhase = done ? 5 : PHASES.indexOf(n.phase as typeof PHASES[number]);
  const doneIds = new Set(inc.steps.filter(s => s.end != null).map(s => s.id));
  const taken = new Set(inc.steps.map(s => s.edge).filter(Boolean) as string[]);
  const ro = !canRun || done;

  let main;
  if (done) {
    const g2 = (sid: string) => g.nodes.find(x => x.id === sid)!;
    const acts = inc.steps.filter(s => { const x = g2(s.id); return x.type === 'action' || x.type === 'escalation'; });
    const over = acts.filter(s => { const x = g2(s.id); return x.sla && s.end! - s.start > x.sla * 60000; }).length;
    const decs = inc.steps.filter(s => g2(s.id).type === 'decision' && s.edge);
    main = (
      <article className="step">
        <div className="step-k"><span className={'tag ' + (inc.status === 'stopped' ? 'crit' : 'ok')}><i />{inc.status === 'stopped' ? 'Response stopped' : 'Incident closed'}</span></div>
        <h3>{inc.name}</h3>
        <div className="summary"><div className="stat"><b>{fmtClock(t)}</b><span>Total time</span></div><div className="stat"><b>{acts.length}</b><span>Steps done</span></div><div className="stat"><b style={{ color: over ? 'var(--crit)' : 'var(--ok)' }}>{over}</b><span>SLA breaches</span></div></div>
        {decs.length > 0 && <div className="decisions">{decs.map(s => { const x = g2(s.id), e = g.edges.find(y => y.id === s.edge); return <div key={s.id}><span>{x.title}</span><b>{e?.label || '—'}</b></div>; })}</div>}
        <div className="nexts">
          {inc.reportId ? <a className="btn primary lg" href={`#/reports/${inc.reportId}`}>Open the report</a>
            : canRun && <button className="btn signal lg" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api.createReport(inc.id); toast(`Report ${r.num} created`); go(`reports/${r.id}`); } catch (e) { toast((e as Error).message, true); setBusy(false); } }}>Create incident report</button>}
          <a className="btn lg" href="#/incidents">Back to incidents</a>
        </div>
      </article>
    );
  } else if (n.type === 'decision') {
    const outs = g.edges.filter(e => e.from === n.id);
    main = (
      <article className="step t-decision">
        <div className="step-k"><span className="code">{codes[n.id]}</span><span className="tag ink">Decision</span>{n.role && <span className="tag line">{n.role}</span>}</div>
        <h3>{n.title}</h3>
        {n.sla > 0 && <Sla start={cur.start} t={t} sla={n.sla} />}
        {n.desc && <p className="desc">{n.desc}</p>}
        <div className="nexts">{outs.map(e => { const tn = g.nodes.find(x => x.id === e.to)!; return (
          <button key={e.id} className="choice" disabled={ro || busy} onClick={() => act(() => api.advance(inc.id, e.id, inc.rev))}><b>{e.label || 'Continue'}</b><span>{tn.title}</span></button>); })}</div>
        {!canRun && <p className="foot">Analysts and above can move the response forward.</p>}
      </article>
    );
  } else {
    const ch = inc.checks[n.id] || [], doneN = n.checklist.filter((_, i) => ch[i]).length, left = n.checklist.length - doneN;
    const outs = g.edges.filter(e => e.from === n.id);
    main = (
      <article className={'step t-' + n.type}>
        <div className="step-k"><span className="code">{codes[n.id]}</span>{n.type === 'escalation' && <span className="tag crit"><i />Escalation</span>}{n.role ? <span className="tag line">{n.role}</span> : <span className="tag warn"><i />No owner</span>}{n.checklist.length > 0 && <span className="tag line">{doneN}/{n.checklist.length} tasks</span>}</div>
        <h3>{n.title}</h3>
        {n.sla > 0 && <Sla start={cur.start} t={t} sla={n.sla} />}
        {n.desc && <p className="desc">{n.desc}</p>}
        {n.checklist.length > 0 && (
          <ul className="tasks">{n.checklist.map((c, i) => (
            <li key={i}><label className={ro ? 'ro' : ''}>
              <input type="checkbox" checked={!!ch[i]} disabled={ro || busy} onChange={e => act(() => api.task(inc.id, n.id, i, e.target.checked))} />
              <span className="box">{Icon.check}</span><span className="tx">{c}</span><span className="tn2">{String(i + 1).padStart(2, '0')}</span>
            </label></li>))}
          </ul>
        )}
        {canRun && <div className="nexts">{outs.map(e => { const tn = g.nodes.find(x => x.id === e.to)!; return (
          <button key={e.id} className={'btn lg ' + (left ? '' : 'primary')} disabled={busy} onClick={() => act(() => api.advance(inc.id, e.id, inc.rev))}>
            {left ? `Complete with ${plural(left, 'open task')}` : 'Complete step'}{outs.length > 1 ? ' → ' + tn.title : ''}</button>); })}</div>}
        {!canRun && <p className="foot">Analysts and above can tick tasks and complete steps.</p>}
      </article>
    );
  }

  return (
    <div className="frame page">
      <div className="runwrap">
        <div className="runhead">
          <div className="t">
            <span className="k">{inc.ref} · {inc.pbCode} {inc.pbName} v{inc.v}{inc.mode === 'exercise' ? ' · exercise' : ''}</span>
            <h2>{inc.name}</h2>
          </div>
          <div><span className="k">Elapsed</span><div className="clock" aria-live="off">{fmtClock(t)}</div></div>
          <div><span className="k">Severity</span><div>
            <select className="inp" style={{ height: 30, marginTop: 6, width: 'auto' }} value={inc.severity} disabled={ro} aria-label="Severity"
              onChange={e => act(() => api.incidentMeta(inc.id, { severity: e.target.value as Severity }))}>{SEVERITIES.map(s => <option key={s}>{s}</option>)}</select></div></div>
          {inc.mode === 'exercise' && !done && (
            <div><span className="k">Clock speed</span><div><div className="seg">{[1, 10, 60, 300].map(s => (
              <button key={s} aria-pressed={inc.clock.speed === s} disabled={ro || busy} onClick={() => act(() => api.speed(inc.id, s))}>×{s}</button>))}</div></div></div>
          )}
          {!done && canRun && <ConfirmButton className="btn danger" label="Stop response" confirmLabel="Click again to stop" onConfirm={() => act(() => api.stop(inc.id), 'Response stopped')} />}
        </div>
        <div className="rail">{PHASES.map((ph, i) => <div key={ph} className={i < curPhase ? 'done' : i === curPhase ? 'cur' : ''}><span className="n">0{i + 1}</span><span className="nm">{ph}</span></div>)}</div>
        <div className="rgrid">
          <div>{main}</div>
          <div className="rside">
            <div className="blk"><div className="blk-h"><h4>Route</h4><span className="tag line">v{inc.v} frozen</span></div>
              <div className="runmap static-wrap"><StaticGraph g={g} pad={34} label="Route taken"
                nodeCls={x => x.id === cur.id && !done ? 'active' : doneIds.has(x.id) ? 'done' : done ? 'skip' : 'pend'}
                edgeCls={e => taken.has(e.id) ? 'taken' : done ? 'skip' : ''} /></div></div>
            <div className="blk"><div className="blk-h"><h4>Timeline</h4><span className="code">{plural(inc.log.length, 'event')}</span></div>
              <ol className="rlog">{inc.log.slice().reverse().map((l, i) => (
                <li key={i} className={l.kind}><time>{fmtT(l.t)}</time><span className="lv">{LOG_LABEL[l.kind]}</span><span className="msg">{l.msg}{l.by && <span className="by"> · {N(l.by)}</span>}</span></li>))}
              </ol></div>
            <Notes inc={inc} readOnly={!canRun} onSaved={apply} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Sla({ start, t, sla }: { start: number; t: number; sla: number }) {
  const el = t - start, max = sla * 60000, ratio = el / max;
  return (
    <div className="slabox">
      <div className={'slabar' + (ratio >= 1 ? ' crit' : ratio >= 0.8 ? ' warn' : '')}><i style={{ width: Math.min(100, ratio * 100) + '%' }} /></div>
      <div className="slatxt">{ratio >= 1 ? <span className="over">SLA breached by {fmtDur(el - max)}</span> : <span>{fmtDur(el)} elapsed</span>}<span>SLA {fmtSla(sla)}</span></div>
    </div>
  );
}

function Notes({ inc, readOnly, onSaved }: { inc: IncidentFull; readOnly: boolean; onSaved: (x: IncidentFull) => void }) {
  const toast = useToast();
  const [v, setV] = useState(inc.notes);
  const [state, setState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const timer = useRef<number>();
  const focused = useRef(false);
  useEffect(() => { if (!focused.current && state === 'saved') setV(inc.notes); }, [inc.notes]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (text: string) => {
    setState('saving');
    try { onSaved(await api.notes(inc.id, text)); setState('saved'); } catch (e) { setState('dirty'); toast((e as Error).message, true); }
  };
  return (
    <div className="blk"><div className="blk-h"><h4>Analyst notes</h4><span className="code">{state === 'saving' ? 'Saving…' : state === 'dirty' ? 'Unsaved' : 'Goes into the report'}</span></div>
      <div className="notes-box">
        <textarea className="inp" value={v} disabled={readOnly} aria-label="Analyst notes" placeholder="Observations, hypotheses, context for the report"
          onFocus={() => { focused.current = true; }}
          onBlur={() => { focused.current = false; if (state === 'dirty') { window.clearTimeout(timer.current); save(v); } }}
          onChange={e => { setV(e.target.value); setState('dirty'); window.clearTimeout(timer.current); const text = e.target.value; timer.current = window.setTimeout(() => save(text), 900); }} />
      </div>
    </div>
  );
}
