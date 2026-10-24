export type NodeType = 'start' | 'action' | 'decision' | 'escalation' | 'end';
export type Role = 'viewer' | 'analyst' | 'editor' | 'admin';
export type Severity = 'Low' | 'Medium' | 'High' | 'Critical';
export type LogKind = 'info' | 'ok' | 'warn' | 'crit' | 'dec';

export interface PNode {
  id: string;
  type: NodeType;
  title: string;
  phase: string;
  role: string;
  /** Target duration in minutes. 0 means no SLA. */
  sla: number;
  desc: string;
  checklist: string[];
  x: number;
  y: number;
}

export interface PEdge {
  id: string;
  from: string;
  to: string;
  label: string;
}

export interface Graph {
  nodes: PNode[];
  edges: PEdge[];
}

export interface Version {
  v: number;
  date: string;
  author: string;
  msg: string;
  graph: Graph;
}

export interface Playbook {
  id: string;
  code: string;
  name: string;
  category: string;
  severity: Severity;
  description: string;
  draft: Graph;
  versions: Version[];
  updatedAt: string;
  updatedBy: string;
  archived?: boolean;
}

export interface PlaybookSummary {
  id: string;
  code: string;
  name: string;
  category: string;
  severity: Severity;
  description: string;
  liveVersion: number | null;
  pendingChanges: number;
  steps: number;
  updatedAt: string;
  updatedBy: string;
}

export interface RunStep {
  id: string;
  /** Incident clock, in ms since declaration. */
  start: number;
  end?: number;
  edge?: string;
  by?: string;
}

export interface LogEntry {
  t: number;
  msg: string;
  kind: LogKind;
  by?: string;
}

export interface Clock {
  /** Incident time (ms) at the anchor. */
  base: number;
  /** Wall-clock ms at the anchor. */
  anchor: number;
  /** 1 for live incidents, more for exercises. */
  speed: number;
}

export interface Incident {
  id: string;
  ref: string;
  name: string;
  playbookId: string;
  pbCode: string;
  pbName: string;
  v: number;
  graph: Graph;
  mode: 'live' | 'exercise';
  severity: Severity;
  status: 'active' | 'closed' | 'stopped';
  startedAt: number;
  clock: Clock;
  /** Frozen incident time once the incident is over. */
  endedAt?: number;
  steps: RunStep[];
  checks: Record<string, boolean[]>;
  log: LogEntry[];
  notes: string;
  reportId?: string | null;
  createdBy: string;
}

export interface ReportStep {
  code: string;
  title: string;
  type: NodeType;
  role: string;
  sla: number;
  dur: number;
  breach: boolean;
  open: number;
}

export interface ReportData {
  ref: string;
  name: string;
  pbCode: string;
  pbName: string;
  v: number;
  mode: 'live' | 'exercise';
  startedAt: number;
  duration: number;
  status: Incident['status'];
  steps: ReportStep[];
  decisions: { q: string; a: string; to: string }[];
  timeline: LogEntry[];
  notes: string;
}

export interface Report {
  id: string;
  num: string;
  incidentId: string;
  templateId: string;
  created: string;
  author: string;
  severity: Severity;
  summary: string;
  notes: string;
  data: ReportData;
}

export type SectionKey = 'summary' | 'timeline' | 'sla' | 'decisions' | 'notes' | 'signoff';

export interface TemplateSection {
  key: SectionKey;
  title: string;
  on: boolean;
}

export interface Template {
  id: string;
  name: string;
  org: string;
  logo: string | null;
  pattern: string;
  seq: number;
  pad: number;
  classification: string;
  accent: string;
  footer: string;
  sections: TemplateSection[];
  isDefault: boolean;
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: Role;
  disabled?: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  user: string;
  action: string;
  target: string;
  detail: string;
}
