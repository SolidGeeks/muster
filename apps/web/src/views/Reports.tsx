// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Report, type Template, SEVERITIES, SECTION_LABEL, fmtDate, plural, formatId,
  defaultPlaybooks, startIncident, simulateIncident, reportData, autoSummary, type Severity
} from '@muster/core';
import { api, fileLinks, saveFile, type ReportRow } from '@muster/backend';
import { useLoad, useChanges, useMe, can, go, Loading, ErrorState, ConfirmButton, useToast, Icon } from '../lib';
import { Sheet } from './Sheet';
import { ColorPicker } from '../ColorPicker';

type Sel = { kind: 'report' | 'tpl'; id: string } | null;
const TOKENS = ['{YYYY}', '{YY}', '{MM}', '{DD}', '{YYMMDD}', '{SEQ}', '{PB}'];

export function Reports({ sel }: { sel: Sel }) {
  const me = useMe();
  const reports = useLoad(() => api.reports(), []);
  const templates = useLoad(() => api.templates(), []);
  useChanges(c => { if (c.type === 'report') reports.reload(); if (c.type === 'templates' && c.by !== me.id) templates.reload(); });

  useEffect(() => {
    if (sel || !reports.data || !templates.data) return;
    if (reports.data[0]) go(`reports/${reports.data[0].id}`); else if (templates.data[0]) go(`reports/templates/${templates.data[0].id}`);
  }, [sel, reports.data, templates.data]);

  if (reports.error || templates.error) return <ErrorState message={reports.error || templates.error!} onRetry={() => { reports.reload(); templates.reload(); }} />;
  if (!reports.data || !templates.data) return <Loading label="Loading reports" />;
  const tpls = templates.data;
  if (!tpls.length && !reports.data.length) return (
    <div className="page"><div className="page-in"><div className="ph"><div><h1>Reports</h1><p>Reports are created from closed incidents and laid out with a report template.</p></div></div>
      <div className="panel"><div className="panel-b"><p className="empty">No report template yet. Load the default playbooks from the Playbooks page: it also adds two report templates.</p></div></div></div></div>
  );

  return (
    <div className="frame col">
      <div className="repgrid">
        <aside className="rside2">
          <div className="side-h"><h2>Reports</h2><p>{reports.data.length ? plural(reports.data.length, 'report') + ' on file' : 'Close an incident to create one.'}</p></div>
          <ul className="rlist">{reports.data.map(r => (
            <li key={r.id}><button className={sel?.kind === 'report' && sel.id === r.id ? 'on' : ''} onClick={() => go(`reports/${r.id}`)}>
              <span className="rn">{r.num}</span><span className="rt">{r.name}</span><small>{fmtDate(r.created)} · {r.severity}{r.mode === 'exercise' ? ' · exercise' : ''}</small>
            </button></li>))}
          </ul>
          <div className="side-h sub"><h2>Templates</h2><p>New reports use the default template.</p></div>
          <ul className="rlist">{tpls.map(t => (
            <li key={t.id}><button className={sel?.kind === 'tpl' && sel.id === t.id ? 'on' : ''} onClick={() => go(`reports/templates/${t.id}`)}>
              <span className="rt">{t.name}</span><small>{t.pattern}{t.isDefault ? ' · default' : ''}</small>
            </button></li>))}
          </ul>
          {can(me, 'editor') && <div style={{ padding: '4px 18px 18px' }}><button className="addrow" style={{ width: '100%' }} onClick={async () => { const t = await api.createTemplate(); await templates.reload(); go(`reports/templates/${t.id}`); }}>New template</button></div>}
        </aside>
        {sel?.kind === 'report' && <ReportEditor key={sel.id} id={sel.id} templates={tpls} onChanged={reports.reload} />}
        {sel?.kind === 'tpl' && (() => { const t = tpls.find(x => x.id === sel.id); return t ? <TemplateEditor key={t.id} initial={t} reports={reports.data} onChanged={templates.reload} /> : <ErrorState message="This template no longer exists." />; })()}
        {!sel && <Loading />}
      </div>
    </div>
  );
}

function ReportEditor({ id, templates, onChanged }: { id: string; templates: Template[]; onChanged: () => void }) {
  const me = useMe();
  const toast = useToast();
  const ro = !can(me, 'analyst');
  const { data, error, reload, setData } = useLoad(() => api.report(id), [id]);
  const [state, setState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [saving, setSaving] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const pendingPatch = useRef<Partial<Report>>({});
  const sheetRef = useRef<HTMLDivElement>(null);
  useChanges(c => { if (c.type === 'report' && c.id === id && c.by !== me.id && state === 'saved') reload(); });

  const flush = async () => {
    const patch = pendingPatch.current; pendingPatch.current = {};
    if (!Object.keys(patch).length) return;
    setState('saving');
    try { await api.updateReport(id, patch); setState('saved'); if ('num' in patch || 'severity' in patch) onChanged(); }
    catch (e) { setState('dirty'); toast((e as Error).message, true); }
  };
  useEffect(() => () => { window.clearTimeout(timer.current); flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (patch: Partial<Report>) => {
    if (!data) return;
    setData({ ...data, ...patch });
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    setState('dirty');
    window.clearTimeout(timer.current); timer.current = window.setTimeout(flush, 800);
  };
  const server = async (patch: Parameters<typeof api.updateReport>[1], ok: string) => {
    await flush();
    try { setData(await api.updateReport(id, patch)); toast(ok); } catch (e) { toast((e as Error).message, true); }
  };

  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading report" />;
  const tpl = templates.find(t => t.id === data.templateId) || templates[0];
  const links = fileLinks('report', id);
  const saveAs = async (kind: 'pdf' | 'md') => {
    setSaving(true);
    try { await flush(); await saveFile(kind, id); }
    catch (e) { const m = (e as Error).message; if (m) toast(m, true); }
    finally { setSaving(false); }
  };

  const copyRich = async () => {
    const el = sheetRef.current?.querySelector('.sheet') as HTMLElement | null;
    if (!el) return;
    try {
      const md = await api.markdown(id);
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([el.outerHTML], { type: 'text/html' }), 'text/plain': new Blob([md], { type: 'text/plain' }) })]);
      toast('Report copied with formatting');
    } catch {
      const r = document.createRange(); r.selectNodeContents(el); const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
      toast('Selected. Press Ctrl+C to copy');
    }
  };

  return (
    <div className="rmain">
      <div className="rform">
        <div className="ins-head"><div><span className="code">Incident report · {fmtDate(data.created)}</span><div className="ins-code" style={{ fontSize: 20, marginTop: 8 }}>{data.num}</div></div><span className="sp" />
          <span className="code" aria-live="polite">{ro ? 'Read only' : state === 'saving' ? 'Saving…' : state === 'dirty' ? 'Unsaved' : 'Saved'}</span></div>
        <section className="grp">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {links.pdf ? <a className="btn primary" href={links.pdf} onClick={() => flush()}>{Icon.download}Download PDF</a>
              : <button className="btn primary" disabled={saving} onClick={() => saveAs('pdf')}>{Icon.download}{saving ? 'Preparing…' : 'Download PDF'}</button>}
            <button className="btn" onClick={copyRich}>Copy formatted</button>
            {links.md ? <a className="btn" href={links.md}>Markdown</a> : <button className="btn" disabled={saving} onClick={() => saveAs('md')}>Markdown</button>}
          </div>
          <p className="foot">The PDF uses the template's logo, colours and sections. Copy formatted pastes into Word, Google Docs or Confluence.</p>
        </section>
        <section className="grp">
          <label className="field">Report ID<input className="inp mono" disabled={ro} value={data.num} onChange={e => edit({ num: e.target.value })} /></label>
          <div className="row2">
            <label className="field">Template<select className="inp" disabled={ro} value={tpl.id} onChange={e => edit({ templateId: e.target.value })}>{templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
            <label className="field">Severity<select className="inp" disabled={ro} value={data.severity} onChange={e => edit({ severity: e.target.value as Severity })}>{SEVERITIES.map(s => <option key={s}>{s}</option>)}</select></label>
          </div>
        </section>
        <section className="grp"><div className="grp-h"><h4>Executive summary</h4>{!ro && <button className="linkbtn" onClick={() => server({ regenerateSummary: true }, 'Summary rewritten from incident data')}>Rewrite from incident data</button>}</div>
          <textarea className="inp" rows={8} disabled={ro} value={data.summary} aria-label="Executive summary" onChange={e => edit({ summary: e.target.value })} /></section>
        <section className="grp"><div className="grp-h"><h4>Analyst notes</h4><span>Free text</span></div>
          <textarea className="inp" rows={8} disabled={ro} value={data.notes} aria-label="Analyst notes" placeholder="Root cause, observations, open questions, recommendations" onChange={e => edit({ notes: e.target.value })} /></section>
        <section className="grp">
          <div className="grp-h"><h4>Incident data</h4><a className="linkbtn" href={`#/incidents/${data.incidentId}`}>Open {data.data.ref}</a></div>
          <p className="foot">Timeline, SLAs and decisions come from the incident record. If the incident changed since this report was created, pull the latest data.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!ro && <button className="btn sm" onClick={() => server({ refresh: true }, 'Incident data refreshed')}>Refresh incident data</button>}
            {can(me, 'admin') && <ConfirmButton label="Delete report" onConfirm={async () => { try { await api.deleteReport(id); toast('Report deleted'); onChanged(); go('reports'); } catch (e) { toast((e as Error).message, true); } }} />}
          </div>
        </section>
      </div>
      <div className="rprev" ref={sheetRef}><Sheet t={tpl} r={data} /></div>
    </div>
  );
}

function sampleReport(): Report {
  const p = defaultPlaybooks()[0];
  const v = p.versions[p.versions.length - 1];
  const inc = startIncident({ id: 'sample', ref: 'INC-2026-0042', name: 'Encrypted finance workstation', playbookId: 'sample', pbCode: p.code, pbName: p.name, v: p.versions.length, graph: v.graph, mode: 'live', speed: 1, severity: 'High', by: 'Sample analyst', now: Date.UTC(2026, 9, 24, 6, 5) });
  simulateIncident(inc, { encrypt: 'Yes', backup: 'Yes' }, { triage: 12, encrypt: 4, isolate: 9, crisis: 21, forensic: 200, backup: 25, restore: 420, review: 90 }, 'Sample analyst');
  inc.notes = 'Sample notes. Your real reports show the analyst notes here.';
  const data = reportData(inc);
  return { id: 'sample', num: 'IR-2026-042', incidentId: 'sample', templateId: '', created: new Date().toISOString(), author: 'Sample analyst', severity: 'High', summary: autoSummary(data), notes: inc.notes, data };
}

function TemplateEditor({ initial, reports, onChanged }: { initial: Template; reports: ReportRow[]; onChanged: () => void }) {
  const me = useMe();
  const toast = useToast();
  const ro = !can(me, 'editor');
  const [t, setT] = useState<Template>(initial);
  const [state, setState] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [preview, setPreview] = useState<Report | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const tRef = useRef(t); tRef.current = t;
  const patRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (reports[0]) api.report(reports[0].id).then(setPreview).catch(() => setPreview(sampleReport()));
    else setPreview(sampleReport());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = async () => {
    window.clearTimeout(timer.current);
    if (ro) return;
    setState('saving');
    try { dirty.current = false; await api.saveTemplate(tRef.current); setState('saved'); onChanged(); }
    catch (e) { setState('dirty'); toast((e as Error).message, true); }
  };
  const dirty = useRef(false);
  useEffect(() => () => { window.clearTimeout(timer.current); if (dirty.current && !ro) api.saveTemplate(tRef.current).catch(() => {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const edit = (patch: Partial<Template>, now = false) => {
    const next = { ...tRef.current, ...patch };
    setT(next); tRef.current = next; setState('dirty'); dirty.current = true;
    window.clearTimeout(timer.current);
    if (now) flush(); else timer.current = window.setTimeout(flush, 700);
  };

  const nextId = useMemo(() => formatId(t, Date.now(), 'PB-001', t.seq), [t]);
  const moveSection = (i: number, j: number) => {
    if (j < 0 || j >= t.sections.length) return;
    const s = [...t.sections]; [s[i], s[j]] = [s[j], s[i]]; edit({ sections: s }, true);
  };
  const onLogo = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return toast('That image is over 2 MB. Use a smaller file.', true);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      // Convert anything (SVG, WebP…) to PNG so the PDF can embed it.
      const scale = Math.min(1, 600 / img.naturalWidth, 240 / img.naturalHeight) || 1;
      const w = Math.max(1, Math.round((img.naturalWidth || 600) * scale)), h = Math.max(1, Math.round((img.naturalHeight || 200) * scale));
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      const data = c.toDataURL('image/png');
      if (data.length > 680000) return toast('The logo is still too large after resizing. Try a simpler image.', true);
      edit({ logo: data }, true); toast('Logo added');
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast("That file couldn't be read as an image.", true); };
    img.src = url;
  };

  const previewRep = preview ? { ...preview, num: nextId } : null;
  return (
    <div className="rmain">
      <div className="rform">
        <div className="ins-head" style={{ flexDirection: 'column', gap: 6 }}>
          <span className="code">Report template{t.isDefault ? ' · default' : ''} · {ro ? 'read only' : state === 'saving' ? 'saving…' : state === 'dirty' ? 'unsaved' : 'saved'}</span>
          <input className="pbname" disabled={ro} value={t.name} aria-label="Template name" onChange={e => edit({ name: e.target.value })} />
        </div>
        <section className="grp"><div className="grp-h"><h4>Identity</h4></div>
          <label className="field">Organisation<input className="inp" disabled={ro} value={t.org} onChange={e => edit({ org: e.target.value })} /></label>
          <div className="field">Logo
            <div className="logo-box">{t.logo ? <img src={t.logo} alt="Logo preview" /> : <span>No logo yet. The organisation name is shown instead.</span>}</div>
            {!ro && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={() => fileRef.current?.click()}>{t.logo ? 'Replace logo' : 'Upload logo'}</button>
              <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={e => { onLogo(e.target.files?.[0]); e.target.value = ''; }} />
              {t.logo && <button className="btn sm danger" onClick={() => edit({ logo: null }, true)}>Remove</button>}
              <span className="hint">PNG, JPG, SVG or WebP</span>
            </div>}
          </div>
          <div className="field">Accent colour<ColorPicker value={t.accent} disabled={ro} onChange={c => edit({ accent: c })} /><span className="hint">Used for the top bar, the report ID and the section numbers. The ratio is its contrast on the white page.</span></div>
          <label className="field">Classification label<input className="inp" disabled={ro} value={t.classification} placeholder="e.g. Confidential" onChange={e => edit({ classification: e.target.value })} /></label>
        </section>
        <section className="grp"><div className="grp-h"><h4>Report ID</h4><span>Next: <span className="nextid">{nextId}</span></span></div>
          <label className="field">Pattern<input ref={patRef} className="inp mono" disabled={ro} value={t.pattern} onChange={e => edit({ pattern: e.target.value })} /></label>
          {!ro && <div className="toks">{TOKENS.map(k => <button key={k} className="tok" title={`Insert ${k}`} onClick={() => {
            const inp = patRef.current!, a = inp.selectionStart ?? inp.value.length, b = inp.selectionEnd ?? a;
            edit({ pattern: inp.value.slice(0, a) + k + inp.value.slice(b) });
            requestAnimationFrame(() => { inp.focus(); inp.setSelectionRange(a + k.length, a + k.length); });
          }}>{k}</button>)}</div>}
          <div className="row2">
            <label className="field">Next number<input className="inp mono" type="number" min={1} disabled={ro} value={t.seq} onChange={e => edit({ seq: Math.max(1, parseInt(e.target.value, 10) || 1) })} /></label>
            <label className="field">Digits<input className="inp mono" type="number" min={1} max={8} disabled={ro} value={t.pad} onChange={e => edit({ pad: Math.min(8, Math.max(1, parseInt(e.target.value, 10) || 1)) })} /></label>
          </div>
          <p className="foot">{'{SEQ}'} goes up by one each time a report uses this template. {'{PB}'} is the playbook code.</p>
        </section>
        <section className="grp"><div className="grp-h"><h4>Sections</h4><span>{t.sections.filter(s => s.on).length} of {t.sections.length} shown</span></div>
          <ul className="secs">{t.sections.map((s, i) => (
            <li key={s.key} className={s.on ? '' : 'off'}>
              <label className="tg" title="Show or hide"><input type="checkbox" disabled={ro} checked={s.on} aria-label={`Show ${s.title}`} onChange={e => edit({ sections: t.sections.map((x, j) => j === i ? { ...x, on: e.target.checked } : x) }, true)} /><span /></label>
              <input className="inp" disabled={ro} value={s.title} title={`Content: ${SECTION_LABEL[s.key]}`} placeholder={SECTION_LABEL[s.key]} aria-label="Section title" onChange={e => edit({ sections: t.sections.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })} />
              <button className="mv" disabled={ro || i === 0} aria-label="Move up" onClick={() => moveSection(i, i - 1)}>{Icon.up}</button>
              <button className="mv" disabled={ro || i === t.sections.length - 1} aria-label="Move down" onClick={() => moveSection(i, i + 1)}>{Icon.down}</button>
            </li>))}
          </ul>
        </section>
        <section className="grp"><label className="field">Footer<textarea className="inp" rows={3} disabled={ro} value={t.footer} onChange={e => edit({ footer: e.target.value })} /></label></section>
        {!ro && <section className="grp"><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {t.isDefault ? <span className="tag line">Used for new reports</span> : <button className="btn sm" onClick={async () => { await flush(); await api.setDefaultTemplate(t.id); setT({ ...tRef.current, isDefault: true }); onChanged(); toast(`${t.name} is now used for new reports`); }}>Use for new reports</button>}
          <button className="btn sm" onClick={async () => { await flush(); const c = await api.createTemplate(t.id); onChanged(); go(`reports/templates/${c.id}`); toast('Template duplicated'); }}>Duplicate</button>
          {!t.isDefault && <ConfirmButton label="Delete template" onConfirm={async () => { try { window.clearTimeout(timer.current); await api.deleteTemplate(t.id); onChanged(); go('reports'); toast('Template deleted'); } catch (e) { toast((e as Error).message, true); } }} />}
        </div></section>}
      </div>
      <div className="rprev">
        <div className="prevnote"><span className="tag line">Preview with {reports[0] ? 'the latest report' : 'sample data'}</span></div>
        {previewRep ? <Sheet t={t} r={previewRep} /> : <Loading label="Loading preview" />}
      </div>
    </div>
  );
}
