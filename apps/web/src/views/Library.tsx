import { useMemo, useState } from 'react';
import { SEVERITIES, fmtDate, plural, type PlaybookSummary, type Severity } from '@muster/core';
import { api, installDefaults } from '@muster/backend';
import { useLoad, useChanges, useMe, can, go, Modal, Loading, ErrorState, useToast, Icon, useNames } from '../lib';
import { DeclareModal } from './Incidents';

export function Library() {
  const me = useMe();
  const N = useNames();
  const { data, error, reload } = useLoad(() => api.playbooks(), []);
  useChanges(c => { if (c.type === 'playbooks' || c.type === 'playbook') reload(); });
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState<PlaybookSummary | null>(null);

  const cats = useMemo(() => [...new Set((data || []).map(p => p.category))].sort(), [data]);
  const shown = (data || []).filter(p => (!cat || p.category === cat) && (!q || `${p.code} ${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q.toLowerCase())));

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading playbooks" />;
  return (
    <div className="page">
      <div className="page-in">
        <div className="ph">
          <div><span className="code">{plural(data.length, 'playbook')}</span><h1>Playbooks</h1><p>Response procedures for the incidents your team handles. Open one to edit it, or run it when an incident starts.</p></div>
          {can(me, 'editor') && <button className="btn primary" onClick={() => setCreating(true)}>{Icon.plus}New playbook</button>}
        </div>
        <div className="toolbar-row">
          <label className="search">{Icon.search}<input className="inp" placeholder="Search playbooks" value={q} onChange={e => setQ(e.target.value)} aria-label="Search playbooks" /></label>
          <div className="chips" role="group" aria-label="Filter by category">
            <button className="chip" aria-pressed={!cat} onClick={() => setCat(null)}>All</button>
            {cats.map(c => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(cat === c ? null : c)}>{c}</button>)}
          </div>
        </div>
        {data.length === 0 ? <EmptyLibrary canInstall={!!installDefaults && can(me, 'editor')} onDone={reload} />
          : shown.length === 0 && <p className="empty">No playbook matches this search.</p>}
        <div className="lib">
          {shown.map(p => (
            <a key={p.id} className="pbcard" href={`#/playbooks/${p.id}`}>
              <div className="top"><span className="code">{p.code} · {p.category}</span><span className={'sev ' + p.severity}><i />{p.severity}</span></div>
              <h3>{p.name}</h3>
              <p>{p.description || 'No description yet.'}</p>
              <div className="meta">
                {p.liveVersion ? <span className="tag ok"><i />v{p.liveVersion} live</span> : <span className="tag warn"><i />Not published</span>}
                {p.pendingChanges > 0 && p.liveVersion && <span className="tag warn">{plural(p.pendingChanges, 'draft change')}</span>}
                <span className="code">{plural(p.steps, 'step')}</span>
                <span className="sp" />
                {can(me, 'analyst') && p.liveVersion && <button className="btn sm" onClick={e => { e.preventDefault(); setRunning(p); }}>Run</button>}
              </div>
              <span className="code" style={{ fontSize: 11 }}>Updated {fmtDate(p.updatedAt)} by {N(p.updatedBy)}</span>
            </a>
          ))}
        </div>
      </div>
      {creating && <NewPlaybookModal existing={data} categories={cats} onClose={() => setCreating(false)} />}
      {running && <DeclareModal playbookId={running.id} onClose={() => setRunning(null)} />}
    </div>
  );
}

function NewPlaybookModal({ existing, categories, onClose }: { existing: PlaybookSummary[]; categories: string[]; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState<Severity>('Medium');
  const [description, setDescription] = useState('');
  const [from, setFrom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const p = await api.createPlaybook({ name, category: category || 'General', severity, description, duplicateOf: from || undefined });
      toast(`${p.code} created`);
      go(`playbooks/${p.id}`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };
  return (
    <Modal title="New playbook" kicker="Playbooks" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!name.trim() || busy} onClick={submit}>{busy ? 'Creating…' : 'Create playbook'}</button></>}>
      {err && <div className="errbox">{err}</div>}
      <label className="field">Name<input className="inp" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Cloud access key exposed" /></label>
      <div className="row2">
        <label className="field">Category<input className="inp" list="cats" value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Cloud" /><datalist id="cats">{categories.map(c => <option key={c} value={c} />)}</datalist></label>
        <label className="field">Default severity<select className="inp" value={severity} onChange={e => setSeverity(e.target.value as Severity)}>{SEVERITIES.map(s => <option key={s}>{s}</option>)}</select></label>
      </div>
      <label className="field">When to use it<textarea className="inp" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="One or two sentences on the situation this playbook covers" /></label>
      <label className="field">Start from<select className="inp" value={from} onChange={e => setFrom(e.target.value)}><option value="">A blank playbook (start and end only)</option>{existing.map(p => <option key={p.id} value={p.id}>A copy of {p.code} {p.name}</option>)}</select></label>
    </Modal>
  );
}

function EmptyLibrary({ canInstall, onDone }: { canInstall: boolean; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <div className="panel"><div className="panel-b" style={{ alignItems: 'flex-start' }}>
      <h3 style={{ font: '650 18px var(--f-ui)' }}>No playbooks yet</h3>
      <p className="empty">{canInstall ? 'Start from the ten default playbooks (ransomware, phishing, compromised account, payment fraud, data breach and more) and the two report templates, or create your own.' : 'An editor of this page can load the default playbooks or create new ones.'}</p>
      {canInstall && <button className="btn primary" disabled={busy} onClick={async () => {
        setBusy(true);
        try { await installDefaults!(); toast('Default playbooks loaded'); onDone(); } catch (e) { toast((e as Error).message, true); } finally { setBusy(false); }
      }}>{busy ? 'Loading playbooks…' : 'Load the default playbooks'}</button>}
    </div></div>
  );
}
