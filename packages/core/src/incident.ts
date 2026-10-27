// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Incident, Clock, Graph, ReportData, Report, Template, LogKind, TemplateSection } from './types';
import { stepCodes } from './graph';
import { fmtDur, fmtLong, fmtSla, fmtHM, fmtT, plural, LOG_LABEL } from './format';

export function clockNow(c: Clock, now = Date.now()): number {
  return Math.max(0, Math.round(c.base + (now - c.anchor) * c.speed));
}

export function incidentTime(inc: Incident, now = Date.now()): number {
  return inc.status === 'active' ? clockNow(inc.clock, now) : (inc.endedAt ?? clockNow(inc.clock, now));
}

export function setSpeed(inc: Incident, speed: number, now = Date.now()): void {
  const t = clockNow(inc.clock, now);
  inc.clock = { base: t, anchor: now, speed };
}

export function currentStep(inc: Incident) {
  return inc.steps[inc.steps.length - 1];
}

function log(inc: Incident, t: number, msg: string, kind: LogKind, by?: string) {
  inc.log.push({ t, msg, kind, ...(by ? { by } : {}) });
}

/** Create an incident on a frozen playbook version and move past Start. */
export function startIncident(params: {
  id: string; ref: string; name: string; playbookId: string; pbCode: string; pbName: string; v: number; graph: Graph;
  mode: 'live' | 'exercise'; speed: number; severity: Incident['severity']; by: string; now?: number; strata?: Incident['strata'];
}): Incident {
  const now = params.now ?? Date.now();
  const st = params.graph.nodes.find(n => n.type === 'start');
  if (!st) throw new Error('This version has no start step');
  const inc: Incident = {
    id: params.id, ref: params.ref, name: params.name, playbookId: params.playbookId, pbCode: params.pbCode, pbName: params.pbName,
    v: params.v, graph: params.graph, mode: params.mode, severity: params.severity, status: 'active', startedAt: now,
    clock: { base: 0, anchor: now, speed: params.mode === 'exercise' ? params.speed : 1 },
    steps: [{ id: st.id, start: 0 }], checks: {}, log: [], notes: '', reportId: null, createdBy: params.by,
    ...(params.strata ? { strata: params.strata } : {})
  };
  log(inc, 0, `${params.mode === 'exercise' ? 'Exercise' : 'Incident'} declared on ${params.pbName} v${params.v}`, 'info', params.by);
  const first = params.graph.edges.find(e => e.from === st.id);
  if (first) advance(inc, first.id, params.by, now);
  return inc;
}

/** Complete the current step through the given connection. Throws on invalid moves. */
export function advance(inc: Incident, edgeId: string, by: string, now = Date.now()): void {
  if (inc.status !== 'active') throw new Error('This incident is not active');
  const g = inc.graph, cur = currentStep(inc);
  const n = g.nodes.find(x => x.id === cur.id);
  const e = g.edges.find(x => x.id === edgeId);
  if (!n || !e || e.from !== n.id) throw new Error('That route does not leave the current step');
  const t = clockNow(inc.clock, now);
  cur.end = t; cur.edge = edgeId; cur.by = by;
  const dur = t - cur.start;
  if (n.type === 'decision') log(inc, t, `${n.title} ${e.label ? e.label.toUpperCase() : '—'}`, 'dec', by);
  else if (n.type !== 'start') {
    const miss = n.checklist.filter((_, i) => !(inc.checks[n.id] || [])[i]).length;
    log(inc, t, `${n.title} completed in ${fmtDur(dur)}` + (miss ? `, ${plural(miss, 'open task')}` : ''), miss ? 'warn' : 'ok', by);
    if (n.sla && dur > n.sla * 60000) log(inc, t, `SLA breached on ${n.title} by ${fmtDur(dur - n.sla * 60000)}`, 'crit');
  }
  const next = g.nodes.find(x => x.id === e.to)!;
  if (next.type === 'end') {
    inc.steps.push({ id: next.id, start: t, end: t });
    inc.status = 'closed'; inc.endedAt = t;
    log(inc, t, 'Incident closed', 'ok', by);
  } else {
    inc.steps.push({ id: next.id, start: t });
    log(inc, t, `Started ${next.title}${next.role ? ' · ' + next.role : ''}`, 'info');
  }
}

export function toggleTask(inc: Incident, nodeId: string, index: number, done: boolean, by: string, now = Date.now()): void {
  if (inc.status !== 'active') throw new Error('This incident is not active');
  const cur = currentStep(inc);
  if (cur.id !== nodeId) throw new Error('Tasks can only be ticked on the current step');
  const n = inc.graph.nodes.find(x => x.id === nodeId);
  if (!n || index < 0 || index >= n.checklist.length) throw new Error('Unknown task');
  const arr = inc.checks[nodeId] ||= [];
  if (!!arr[index] === done) return;
  arr[index] = done;
  const t = clockNow(inc.clock, now);
  log(inc, t, done ? n.checklist[index] : `Reopened: ${n.checklist[index]}`, done ? 'ok' : 'info', by);
}

export function stopIncident(inc: Incident, by: string, now = Date.now()): void {
  if (inc.status !== 'active') throw new Error('This incident is not active');
  const t = clockNow(inc.clock, now);
  const cur = currentStep(inc);
  if (cur.end == null) cur.end = t;
  inc.status = 'stopped'; inc.endedAt = t;
  log(inc, t, 'Response stopped manually', 'crit', by);
}

/** Run a whole incident instantly with fixed durations (minutes per step). Used for samples and tests. */
export function simulateIncident(inc: Incident, choices: Record<string, string>, minutes: Record<string, number>, by: string): Incident {
  let guard = 0;
  let wall = inc.clock.anchor;
  while (inc.status === 'active' && guard++ < 100) {
    const cur = currentStep(inc);
    const n = inc.graph.nodes.find(x => x.id === cur.id)!;
    const outs = inc.graph.edges.filter(e => e.from === n.id);
    if (!outs.length) break;
    wall += (minutes[n.id] ?? Math.round((n.sla || 5) * 0.8)) * 60000 / inc.clock.speed;
    if (n.checklist.length) inc.checks[n.id] = n.checklist.map(() => true);
    const e = n.type === 'decision' ? (outs.find(x => x.label === choices[n.id]) || outs[0]) : outs[0];
    advance(inc, e.id, by, wall);
  }
  return inc;
}

export function reportData(inc: Incident, now = Date.now()): ReportData {
  const g = inc.graph, f = (id: string) => g.nodes.find(x => x.id === id), codes = stepCodes(g);
  const steps = inc.steps
    .map(s => ({ n: f(s.id), s }))
    .filter(o => o.n && (o.n.type === 'action' || o.n.type === 'escalation') && o.s.end != null)
    .map(({ n, s }) => {
      const dur = s.end! - s.start, ch = inc.checks[n!.id] || [];
      return { code: codes[n!.id], title: n!.title, type: n!.type, role: n!.role, sla: n!.sla, dur, breach: !!(n!.sla && dur > n!.sla * 60000), open: n!.checklist.filter((_, i) => !ch[i]).length };
    });
  const decisions = inc.steps
    .filter(s => { const n = f(s.id); return n && n.type === 'decision' && s.edge; })
    .map(s => { const n = f(s.id)!, e = g.edges.find(x => x.id === s.edge), t = e && f(e.to); return { q: n.title, a: e && e.label ? e.label : '—', to: t ? t.title : '' }; });
  return {
    ref: inc.ref, name: inc.name, pbCode: inc.pbCode, pbName: inc.pbName, v: inc.v, mode: inc.mode, startedAt: inc.startedAt,
    duration: inc.status === 'active' ? clockNow(inc.clock, now) : (inc.endedAt ?? 0), status: inc.status,
    steps, decisions, timeline: inc.log.map(l => ({ ...l })), notes: inc.notes || ''
  };
}

export function autoSummary(d: ReportData): string {
  const withSla = d.steps.filter(s => s.sla), met = withSla.filter(s => !s.breach).length, br = d.steps.filter(s => s.breach);
  const kind = d.mode === 'exercise' ? 'exercise' : 'incident';
  let t = `On ${fmtLong(d.startedAt)}, the ${kind} “${d.name}” (${d.ref}) was declared and handled with playbook ${d.pbCode} ${d.pbName} v${d.v}. `;
  t += d.status === 'stopped' ? `The response was stopped after ${fmtDur(d.duration)}, with ${plural(d.steps.length, 'step')} completed.`
    : d.status === 'closed' ? `It was closed after ${fmtDur(d.duration)}, across ${plural(d.steps.length, 'step')}.`
      : `The response has been running for ${fmtDur(d.duration)}.`;
  if (d.decisions.length) t += '\n\nKey decisions: ' + d.decisions.map(x => `${x.q.replace(/\?$/, '')}: ${x.a.toLowerCase()}`).join('; ') + '.';
  if (withSla.length) t += `\n\n${met} of ${withSla.length} SLAs were met` + (br.length ? `. Breaches: ${br.map(s => s.title).join(', ')}.` : '.');
  return t;
}

export function formatId(tpl: Pick<Template, 'pattern' | 'pad'>, date: number | string, pbCode: string, seq: number): string {
  const d = new Date(date), p = (n: number) => String(n).padStart(2, '0'), yy = String(d.getUTCFullYear()).slice(2);
  const pad = Math.min(8, Math.max(1, +tpl.pad || 1));
  return String(tpl.pattern || '')
    .replace(/\{YYYY\}/g, String(d.getUTCFullYear()))
    .replace(/\{YYMMDD\}/g, yy + p(d.getUTCMonth() + 1) + p(d.getUTCDate()))
    .replace(/\{YY\}/g, yy)
    .replace(/\{MM\}/g, p(d.getUTCMonth() + 1))
    .replace(/\{DD\}/g, p(d.getUTCDate()))
    .replace(/\{SEQ\}/g, String(seq).padStart(pad, '0'))
    .replace(/\{PB\}/g, pbCode || 'PB');
}

export const SECTION_LABEL: Record<TemplateSection['key'], string> = {
  summary: 'Executive summary', timeline: 'Timeline', sla: 'SLA performance', decisions: 'Key decisions', notes: 'Analyst notes', signoff: 'Sign-off'
};

export function defaultTemplates(): Template[] {
  const mk = (a: [TemplateSection['key'], string, boolean][]) => a.map(([key, title, on]) => ({ key, title, on }));
  return [
    {
      id: 'tpl-std', name: 'Standard incident report', org: 'Northwind Group', logo: null, pattern: 'IR-{YYYY}-{SEQ}', seq: 42, pad: 3,
      classification: 'Confidential', accent: '#FF5A1F', isDefault: true,
      footer: 'Prepared by Northwind Security Operations. Do not forward outside the organisation.',
      sections: mk([['summary', 'Executive summary', true], ['timeline', 'Timeline', true], ['sla', 'SLA performance', true], ['decisions', 'Key decisions', true], ['notes', 'Analyst notes', true], ['signoff', 'Sign-off', true]])
    },
    {
      id: 'tpl-reg', name: 'Regulator brief', org: 'Northwind Group', logo: null, pattern: '{PB}-REG-{YYMMDD}-{SEQ}', seq: 1, pad: 2,
      classification: 'Restricted · Legal review', accent: '#121413', isDefault: false,
      footer: 'Prepared for notification to the supervisory authority. Legal reviews it before submission.',
      sections: mk([['summary', 'Summary of the breach', true], ['decisions', 'Containment decisions', true], ['timeline', 'Chronology', true], ['sla', 'Response times', false], ['notes', 'Analyst notes', false], ['signoff', 'Approval', true]])
    }
  ];
}

export function reportStatusLabel(s: ReportData['status']): string {
  return s === 'stopped' ? 'Response stopped' : s === 'closed' ? 'Closed' : 'In progress';
}

export function toMarkdown(t: Template, r: Report): string {
  const d = r.data, withSla = d.steps.filter(s => s.sla), met = withSla.filter(s => !s.breach).length;
  // User text must stay where it is put: on its line (headings, list items) and in its table cell.
  // Summary and notes are left alone: they are free Markdown written by the analyst.
  const oneLine = (x: unknown) => String(x ?? '').replace(/[\r\n]+/g, ' ');
  // Escape the backslash first, or "a\|b" would become "a\\|b": an escaped backslash, then a column break
  const cell = (x: unknown) => oneLine(x).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  let m = `# ${oneLine(r.num)} — ${oneLine(d.name)}\n\n${oneLine(t.org)}${t.classification ? ' · ' + oneLine(t.classification) : ''}\n\n| Field | Value |\n|---|---|\n` +
    `| Incident | ${cell(d.ref)}${d.mode === 'exercise' ? ' (exercise)' : ''} |\n| Playbook | ${cell(d.pbCode)} ${cell(d.pbName)} v${cell(d.v)} |\n| Severity | ${cell(r.severity)} |\n| Status | ${reportStatusLabel(d.status)} |\n` +
    `| Declared | ${fmtLong(d.startedAt)} |\n| Duration | ${fmtDur(d.duration)} |\n| SLAs met | ${withSla.length ? met + ' / ' + withSla.length : '—'} |\n| Author | ${cell(r.author)} |\n\n`;
  t.sections.filter(s => s.on).forEach((s, i) => {
    m += `## ${String(i + 1).padStart(2, '0')} ${oneLine(s.title)}\n\n`;
    if (s.key === 'summary') m += (r.summary || '') + '\n\n';
    else if (s.key === 'notes') m += (r.notes || '_No analyst notes._') + '\n\n';
    else if (s.key === 'timeline') m += '| UTC | T+ | Type | Event |\n|---|---|---|---|\n' + d.timeline.map(l => `| ${fmtHM(d.startedAt + l.t)} | ${fmtT(l.t).slice(2)} | ${LOG_LABEL[l.kind] || ''} | ${cell(l.msg)} |`).join('\n') + '\n\n';
    else if (s.key === 'sla') m += '| Step | Owner | Target | Actual | Status |\n|---|---|---|---|---|\n' + d.steps.map(x => `| ${cell(x.code)} ${cell(x.title)} | ${x.role ? cell(x.role) : '—'} | ${x.sla ? fmtSla(x.sla) : '—'} | ${fmtDur(x.dur)} | ${!x.sla ? '—' : x.breach ? 'Breached' : 'Met'} |`).join('\n') + '\n\n';
    else if (s.key === 'decisions') m += (d.decisions.map(x => `- **${oneLine(x.q)}** ${oneLine(x.a)}, then ${oneLine(x.to)}`).join('\n') || '_No decisions recorded._') + '\n\n';
    else if (s.key === 'signoff') m += `- Prepared by: ${oneLine(r.author)}\n- Reviewed by:\n- Approved by:\n\n`;
  });
  return m + `---\n\n${t.footer}\n`;
}

export function toYaml(p: { code: string; name: string; category?: string }, g: Graph, liveVersion: number | null): string {
  const q = (s: unknown) => JSON.stringify(String(s));
  let y = `# ${p.code} ${p.name} — draft (live: ${liveVersion ? 'v' + liveVersion : 'none'})\nplaybook: ${q(p.name)}\nid: ${p.code}\n${p.category ? `category: ${q(p.category)}\n` : ''}schema: muster/v1\nsteps:\n`;
  for (const n of g.nodes) {
    y += `  - id: ${n.id}\n    type: ${n.type}\n    title: ${q(n.title)}\n`;
    if (n.phase) y += `    phase: ${q(n.phase)}\n`;
    if (n.role) y += `    owner: ${q(n.role)}\n`;
    if (n.sla) y += `    sla_minutes: ${n.sla}\n`;
    if (n.desc) y += `    instructions: ${q(n.desc)}\n`;
    if (n.checklist.length) y += `    checklist:\n` + n.checklist.map(c => `      - ${q(c)}\n`).join('');
    if (n.targets?.length) y += `    targets: [${n.targets.map(q).join(', ')}]\n`;
    if (n.effects && Object.keys(n.effects).length) y += `    effects:\n` + Object.entries(n.effects).map(([k, [st, sel]]) => `      ${q(k)}: [${st}, ${q(sel)}]\n`).join('');
    const o = g.edges.filter(e => e.from === n.id);
    if (o.length) y += `    next:\n` + o.map(e => `      - to: ${e.to}` + (e.label ? `\n        when: ${q(e.label)}` : '') + '\n').join('');
  }
  return y;
}
