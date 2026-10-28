// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react';
import { SEVERITIES, fmtClock, fmtLong, plural, type Severity } from '@muster/core';
import { api, type IncidentRow, type PlaybookFull } from '@muster/backend';
import { useLoad, useChanges, useMe, can, go, Modal, Loading, ErrorState, useToast, useNow, Icon, useNames } from '../lib';
import { StaticGraph } from '../graph';

export function Incidents() {
  const me = useMe();
  const N = useNames();
  const { data, error, reload } = useLoad(() => api.incidents(), []);
  useChanges(c => { if (c.type === 'incident') reload(); });
  const [filter, setFilter] = useState<'active' | 'closed' | 'all'>('active');
  const [declaring, setDeclaring] = useState(false);
  const now = useNow(1000);
  const [loadedAt, setLoadedAt] = useState(Date.now());
  useEffect(() => { if (data) setLoadedAt(Date.now()); }, [data]);

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading incidents" />;
  const active = data.filter(i => i.status === 'active');
  const rows = data.filter(i => filter === 'all' || (filter === 'active' ? i.status === 'active' : i.status !== 'active'));
  const elapsed = (i: IncidentRow) => i.status === 'active' ? i.elapsed + (now - loadedAt) * i.speed : i.elapsed;

  return (
    <div className="page">
      <div className="page-in">
        <div className="ph">
          <div><span className="code">{active.length ? `${plural(active.length, 'response')} in progress` : 'No response in progress'}</span><h1>Incidents</h1><p>Every response runs on a frozen playbook version. Exercises use an accelerated clock for tabletop sessions.</p></div>
          {can(me, 'analyst') && <button className="btn signal" onClick={() => setDeclaring(true)}>{Icon.plus}Declare an incident</button>}
        </div>
        <div className="toolbar-row">
          <div className="chips" role="group" aria-label="Filter incidents">
            {(['active', 'closed', 'all'] as const).map(f => <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'active' ? `In progress (${active.length})` : f === 'closed' ? 'Closed' : 'All'}</button>)}
          </div>
        </div>
        {rows.length === 0 ? (
          <div className="panel"><div className="panel-b"><p className="empty">{filter === 'active' ? 'Nothing in progress. Declare an incident or start an exercise from a playbook.' : 'No incidents here yet.'}</p></div></div>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Incident</th><th>Playbook</th><th>Current step</th><th>Severity</th><th className="r">Elapsed</th><th>Status</th></tr></thead>
              <tbody>
                {rows.map(i => (
                  <tr key={i.id} className="click" tabIndex={0} onClick={() => go(`incidents/${i.id}`)} onKeyDown={e => { if (e.key === 'Enter') go(`incidents/${i.id}`); }}>
                    <td className="t"><span className="code">{i.ref}</span><b>{i.name}</b><small>{fmtLong(i.startedAt)} · {N(i.createdBy)}</small></td>
                    <td className="t"><b style={{ fontWeight: 500 }}>{i.pbName}</b><small className="mono">{i.pbCode} v{i.v}</small></td>
                    <td>{i.current ? <span className={i.current.overdue ? 'overdue' : ''}><span className="code">{i.current.code}</span> {i.current.title}{i.current.overdue && ' · SLA breached'}</span> : <span className="empty">—</span>}</td>
                    <td><span className={'sev ' + i.severity}><i />{i.severity}</span></td>
                    <td className="r m">{fmtClock(elapsed(i))}</td>
                    <td><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {i.status === 'active' ? <span className="tag live"><i />In progress</span> : i.status === 'closed' ? <span className="tag ok"><i />Closed</span> : <span className="tag crit"><i />Stopped</span>}
                      {i.mode === 'exercise' && <span className="tag line">Exercise ×{i.speed}</span>}
                      {i.reportId && <span className="tag line">Report</span>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {declaring && <DeclareModal onClose={() => setDeclaring(false)} />}
    </div>
  );
}

export function DeclareModal({ playbookId, onClose }: { playbookId?: string; onClose: () => void }) {
  const toast = useToast();
  const list = useLoad(() => api.playbooks(), []);
  const [pid, setPid] = useState(playbookId || '');
  const [pb, setPb] = useState<PlaybookFull | null>(null);
  const [v, setV] = useState(0);
  const [name, setName] = useState('');
  const [severity, setSeverity] = useState<Severity>('High');
  const [mode, setMode] = useState<'live' | 'exercise'>('live');
  const [speed, setSpeed] = useState(60);
  const [site, setSite] = useState('');
  const [assets, setAssets] = useState('');
  const [cve, setCve] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const published = (list.data || []).filter(p => p.liveVersion);

  useEffect(() => { if (!pid && published.length) setPid(published[0].id); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pid) return;
    setPb(null);
    api.playbook(pid).then(p => { setPb(p); setV(p.versions.length ? p.versions[p.versions.length - 1].v : 0); setSeverity(p.severity); }).catch(e => setErr((e as Error).message));
  }, [pid]);
  const ver = pb?.versions.find(x => x.v === v);

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const list = assets.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
      const strata = site.trim() || list.length || cve.trim() ? { site: site.trim(), assets: list, params: (cve.trim() ? { cve: cve.trim() } : {}) as Record<string, string> } : null;
      const inc = await api.declare({ playbookId: pid, v, name: name.trim(), mode, speed, severity, strata });
      toast(`${inc.ref} declared`);
      go(`incidents/${inc.id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal wide kicker="New response" title={mode === 'exercise' ? 'Start an exercise' : 'Declare an incident'} onClose={onClose}
      actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn signal" disabled={busy || !name.trim() || !ver} onClick={submit}>{busy ? 'Starting…' : mode === 'exercise' ? 'Start exercise' : 'Start response'}</button></>}>
      {err && <div className="errbox">{err}</div>}
      <div className="radio-cards" role="radiogroup" aria-label="Kind of response">
        <label><input type="radio" name="mode" checked={mode === 'live'} onChange={() => setMode('live')} /><b>Live incident</b>Real time. SLAs count for real.</label>
        <label><input type="radio" name="mode" checked={mode === 'exercise'} onChange={() => setMode('exercise')} /><b>Exercise</b>Accelerated clock for tabletop sessions and training.</label>
      </div>
      <label className="field">Incident name<input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder={mode === 'exercise' ? 'e.g. Tabletop: encrypted file server' : 'e.g. Encrypted finance workstation'} /></label>
      <div className="row2">
        <label className="field">Playbook<select className="inp" value={pid} onChange={e => setPid(e.target.value)} disabled={!list.data}>
          {!list.data && <option>Loading…</option>}
          {published.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
        </select></label>
        <label className="field">Version<select className="inp" value={v} onChange={e => setV(Number(e.target.value))} disabled={!pb}>
          {pb?.versions.slice().reverse().map((x, i) => <option key={x.v} value={x.v}>v{x.v}{i === 0 ? ' (live)' : ''} · {x.msg.slice(0, 40)}</option>)}
        </select></label>
      </div>
      <div className="row2">
        <label className="field">Severity<select className="inp" value={severity} onChange={e => setSeverity(e.target.value as Severity)}>{SEVERITIES.map(s => <option key={s}>{s}</option>)}</select></label>
        {mode === 'exercise' ? (
          <label className="field">Clock speed<select className="inp" value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[1, 10, 60, 300].map(s => <option key={s} value={s}>×{s}{s === 60 ? ' (one minute per second)' : ''}</option>)}</select></label>
        ) : <div className="field">Clock<div className="inp" style={{ display: 'flex', alignItems: 'center', color: 'var(--muted)' }}>Real time</div></div>}
      </div>
      <details className="strata-link">
        <summary>Link to Strata (optional)</summary>
        <p className="foot">Strata opens the incident on its map: the assets you name are marked compromised, and each playbook step points at the assets, flows and contacts it acts on.</p>
        <div className="row2">
          <label className="field">Strata IS id<input className="inp" value={site} onChange={e => setSite(e.target.value)} placeholder="e.g. lyon" /></label>
          <label className="field">Vulnerability (for {'{cve}'} targets)<input className="inp" value={cve} onChange={e => setCve(e.target.value)} placeholder="e.g. CVE-2024-21887" /></label>
        </div>
        <label className="field">Assets hit, by name or Strata id, comma-separated<input className="inp" value={assets} onChange={e => setAssets(e.target.value)} placeholder="e.g. file-01, pc-acct-01" /></label>
      </details>
      <div className="static-wrap" style={{ height: 220, borderRadius: 4, border: '1px solid var(--rule)' }}>
        {ver ? <StaticGraph g={ver.graph} label="Playbook preview" /> : <Loading label="Loading preview" />}
      </div>
      <p className="foot">The response follows the version you pick. Updates published while it runs won't change it.</p>
    </Modal>
  );
}
