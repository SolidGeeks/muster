import type { ReactElement } from 'react';
import type { Report, Template } from '@muster/core';
import { fmtDur, fmtLong, fmtSla, fmtHM, fmtT, LOG_LABEL, reportStatusLabel } from '@muster/core';
import { useNames } from '../lib';

const safeAcc = (c: string) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : '#121413');

function Paras({ text, className }: { text: string; className: string }) {
  return <div className={className}>{(text || '').split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}</div>;
}

/** HTML rendering of a report. Mirrors the server-side PDF layout. */
export function Sheet({ t, r }: { t: Template; r: Report }) {
  const N = useNames();
  const d = r.data, withSla = d.steps.filter(s => s.sla), met = withSla.filter(s => !s.breach).length;
  const sections: Record<string, () => ReactElement> = {
    summary: () => <Paras className="rp-lead" text={r.summary} />,
    timeline: () => (
      <div className="tablewrap"><table className="rp-t"><thead><tr><th>UTC</th><th>T+</th><th>Type</th><th>Event</th></tr></thead>
        <tbody>{d.timeline.map((l, i) => <tr key={i} className={l.kind}><td className="m">{fmtHM(d.startedAt + l.t)}</td><td className="m">{fmtT(l.t).slice(2)}</td><td className="m lvt">{LOG_LABEL[l.kind]}</td><td>{l.msg}{l.by ? <span style={{ color: 'var(--muted)' }}> · {N(l.by)}</span> : null}</td></tr>)}</tbody></table></div>
    ),
    sla: () => d.steps.length ? (<>
      <div className="tablewrap"><table className="rp-t"><thead><tr><th>Step</th><th>Owner</th><th className="r">Target</th><th className="r">Actual</th><th className="r">Status</th></tr></thead>
        <tbody>{d.steps.map((s, i) => <tr key={i}><td><span className="m sc">{s.code}</span>{s.title}</td><td>{s.role || '—'}</td><td className="m r">{s.sla ? fmtSla(s.sla) : '—'}</td><td className="m r">{fmtDur(s.dur)}</td><td className="r">{!s.sla ? '—' : s.breach ? <span className="st-br">Breached</span> : <span className="st-ok">Met</span>}</td></tr>)}</tbody></table></div>
      {withSla.length > 0 && <p className="rp-note">{met} of {withSla.length} SLAs met.</p>}
    </>) : <p className="rp-empty">No steps were completed.</p>,
    decisions: () => d.decisions.length ? <div className="rp-dec">{d.decisions.map((x, i) => <div key={i}><span>{x.q}</span><b>{x.a}</b><small>Led to {x.to}</small></div>)}</div> : <p className="rp-empty">No decisions recorded.</p>,
    notes: () => r.notes ? <Paras className="rp-body" text={r.notes} /> : <p className="rp-empty">No analyst notes.</p>,
    signoff: () => <div className="rp-sign">{[['Prepared by', N(r.author)], ['Reviewed by', ''], ['Approved by', '']].map(([k, v]) => <div key={k}><small>{k}</small><b>{v || ' '}</b><i /><small>Date</small></div>)}</div>
  };
  const meta: [string, ReactElement | string][] = [
    ['Severity', <span className={'sev2 ' + r.severity}><i />{r.severity}</span>], ['Status', reportStatusLabel(d.status)], ['Declared', fmtLong(d.startedAt)],
    ['Duration', fmtDur(d.duration)], ['SLAs met', withSla.length ? `${met} / ${withSla.length}` : '—'], ['Author', N(r.author)]
  ];
  return (
    <article className="sheet" style={{ ['--acc' as string]: safeAcc(t.accent) }}>
      <div className="rp-top">
        <div className="rp-brand">{t.logo ? <img src={t.logo} alt={t.org} /> : <span className="rp-org">{t.org}</span>}</div>
        {t.classification && <span className="rp-class">{t.classification}</span>}
      </div>
      <div className="rp-id">{r.num}</div>
      <h1>{d.name}</h1>
      <div className="rp-sub">Incident report · {d.ref}{d.mode === 'exercise' ? ' (exercise)' : ''} · {d.pbCode} {d.pbName} v{d.v}</div>
      <div className="rp-meta">{meta.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}</div>
      {t.sections.filter(s => s.on).map((s, i) => (
        <section className="rp-sec" key={s.key}><h2><span>{String(i + 1).padStart(2, '0')}</span>{s.title}</h2>{sections[s.key]()}</section>
      ))}
      <div className="rp-foot"><span>{t.footer}</span><span className="m">{r.num}</span></div>
    </article>
  );
}
