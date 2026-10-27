// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Graph, NodeType, PNode, Severity } from './types';
import { layout, makeNode, makeEdge, clone } from './graph';

type StepDef = [id: string, type: NodeType, title: string, phase: string, role?: string, sla?: number, desc?: string, checklist?: string[]];
type EdgeDef = [from: string, to: string, label?: string];

function build(steps: StepDef[], edges: EdgeDef[]): Graph {
  return layout({
    nodes: steps.map(([id, type, title, phase, role = '', sla = 0, desc = '', checklist = []]) => makeNode(id, type, title, phase, role, sla, desc, checklist)),
    edges: edges.map(([f, t, l]) => makeEdge(f, t, l))
  });
}

export interface SeedPlaybook {
  code: string;
  name: string;
  category: string;
  severity: Severity;
  description: string;
  versions: { date: string; author: string; msg: string; graph: Graph }[];
  draft: Graph;
}

const D = 'Lessons learned';

// What each step acts on in Strata, when the incident is linked to its map (see strata.ts)
type Aim = Record<string, { targets?: string[]; effects?: PNode['effects'] }>;
function aim(g: Graph, a: Aim): Graph {
  g.nodes.forEach(n => { const x = a[n.id]; if (x?.targets) n.targets = x.targets; if (x?.effects) n.effects = x.effects; });
  return g;
}
const RANSOMWARE_AIM: Aim = {
  triage: { targets: ['affected', 'contacts:affected'] },
  encrypt: { targets: ['compromised'] },
  isolate: { targets: ['affected', 'flows:affected'] },
  crisis: { targets: ['business:affected', 'contacts:is'] },
  forensic: { targets: ['affected', 'reach:affected'] },
  backup: { targets: ['role:backup', 'flows:role:backup'] },
  restore: { targets: ['compromised', 'consumers:compromised'] },
  rebuild: { targets: ['compromised', 'type:dc'] },
  watch: { targets: ['affected', 'role:SIEM'] }
};

/* 1 — Ransomware: ships with three versions and an unpublished change, to show history and diffs. */
function ransomware(): SeedPlaybook {
  const v3 = aim(build([
    ['start', 'start', 'Alert received', 'Detection'],
    ['triage', 'action', 'Triage the alert', 'Detection', 'L1 Analyst', 15, 'Confirm ransomware activity and rule out a false positive before anyone escalates.', ['Check the alert source (EDR, SIEM, user report)', 'List affected hosts and accounts', 'Open the incident ticket']],
    ['encrypt', 'decision', 'Encryption in progress?', 'Detection', 'L1 Analyst', 5, 'Are files being encrypted or mass-renamed right now?'],
    ['isolate', 'action', 'Isolate affected hosts', 'Containment', 'L2 Analyst', 10, 'Stop the spread before any analysis. Do not power machines off: memory is evidence.', ['Isolate endpoints through the EDR', 'Disable exposed SMB shares', 'Disable compromised accounts']],
    ['crisis', 'escalation', 'Activate the crisis cell', 'Containment', 'CISO', 15, 'Escalate to leadership, the insurer and the authorities.', ['Notify executive leadership', 'Call the cyber insurer', 'Assess CNIL (72 h) and ANSSI notification']],
    ['forensic', 'action', 'Forensic analysis', 'Eradication', 'IR Lead', 240, 'Find the initial access vector and every persistence mechanism.', ['Capture memory and disks from key hosts', 'Identify patient zero', 'Extract IOCs and block them']],
    ['backup', 'decision', 'Clean backups available?', 'Recovery', 'Sysadmin', 30, 'Are offline backups intact and older than the compromise?'],
    ['restore', 'action', 'Restore from backups', 'Recovery', 'Sysadmin', 480, '', ['Restore into an isolated network segment', 'Scan restored data', 'Return to production in batches']],
    ['rebuild', 'action', 'Rebuild systems', 'Recovery', 'Sysadmin', 1440, 'Reinstall from trusted golden images.', ['Reinstall from reference images', 'Rotate every domain secret']],
    ['watch', 'action', 'Heightened monitoring', 'Detection', 'L1 Analyst', 60, 'No encryption observed. Monitor closely and document.', ['Create a detection rule for the IOCs', 'Watch the hosts for 24 h']],
    ['review', 'action', 'Post-incident review', D, 'IR Lead', 120, '', ['Write the timeline', 'List corrective actions', 'Update this playbook']],
    ['end', 'end', 'Incident closed', D]
  ], [['start', 'triage'], ['triage', 'encrypt'], ['encrypt', 'isolate', 'Yes'], ['encrypt', 'watch', 'No'], ['isolate', 'crisis'], ['crisis', 'forensic'], ['forensic', 'backup'], ['backup', 'restore', 'Yes'], ['backup', 'rebuild', 'No'], ['restore', 'review'], ['rebuild', 'review'], ['watch', 'review'], ['review', 'end']]), RANSOMWARE_AIM);
  const v2 = clone(v3);
  v2.nodes.find(n => n.id === 'crisis')!.checklist.pop();
  v2.nodes.find(n => n.id === 'review')!.checklist.pop();
  const v1 = clone(v2);
  v1.nodes = v1.nodes.filter(n => n.id !== 'crisis' && n.id !== 'watch');
  v1.edges = v1.edges.filter(e => !['crisis', 'watch'].includes(e.from) && !['crisis', 'watch'].includes(e.to));
  v1.edges.push(makeEdge('isolate', 'forensic'), makeEdge('encrypt', 'review', 'No'));
  const t = v1.nodes.find(n => n.id === 'triage')!; t.sla = 30; t.checklist.pop();
  const draft = clone(v3);
  const iso = draft.nodes.find(n => n.id === 'isolate')!; iso.sla = 5; iso.checklist.push('Warn the service desk');
  return {
    code: 'PB-001', name: 'Ransomware', category: 'Malware', severity: 'Critical',
    description: 'Files encrypted or ransom note found. Contain fast, escalate early, restore from clean backups.',
    versions: [
      { date: '2026-03-12T10:00:00Z', author: 'Camille R.', msg: 'Initial version approved by the security committee', graph: v1 },
      { date: '2026-06-04T14:30:00Z', author: 'Camille R.', msg: 'Added the crisis cell and the no-encryption branch', graph: v2 },
      { date: '2026-09-18T09:15:00Z', author: 'Noah L.', msg: 'Regulator notification and review update after the tabletop exercise', graph: v3 }
    ],
    draft
  };
}

function phishing(): SeedPlaybook {
  const v1 = build([
    ['start', 'start', 'Suspicious email reported', 'Detection'],
    ['analyse', 'action', 'Analyse the email', 'Detection', 'L1 Analyst', 20, 'Headers, links and attachments go through the sandbox.', ['Extract headers and URLs', 'Detonate attachments in the sandbox', 'Find every other recipient']],
    ['malicious', 'decision', 'Is the email malicious?', 'Detection', 'L1 Analyst', 10, 'Use sandbox verdicts, reputation and sender checks.'],
    ['purge', 'action', 'Purge the email', 'Containment', 'Sysadmin', 30, '', ['Delete the email from every mailbox', 'Block the sender, domain and URLs']],
    ['clicked', 'decision', 'Link clicked or file opened?', 'Containment', 'L1 Analyst', 10, 'Check proxy and EDR logs for every recipient.'],
    ['reset', 'action', 'Reset credentials', 'Containment', 'L2 Analyst', 15, '', ['Force a password change', 'Revoke active sessions', 'Check mailbox forwarding rules']],
    ['endpoint', 'action', 'Investigate the endpoint', 'Eradication', 'L2 Analyst', 90, '', ['Run a full EDR scan', 'Look for persistence']],
    ['benign', 'action', 'Reply to the reporter', D, 'L1 Analyst', 15, 'Thank the reporter and explain the verdict.', ['Send the verdict to the reporter', 'Release the email if quarantined']],
    ['end', 'end', 'Incident closed', D]
  ], [['start', 'analyse'], ['analyse', 'malicious'], ['malicious', 'purge', 'Yes'], ['malicious', 'benign', 'No'], ['purge', 'clicked'], ['clicked', 'reset', 'Yes'], ['clicked', 'end', 'No'], ['reset', 'endpoint'], ['endpoint', 'end'], ['benign', 'end']]);
  const draft = clone(v1);
  draft.nodes.push(makeNode('coach', 'action', 'Coach the user', D, '', 0, 'Walk through the warning signs, without blame.'));
  layout(draft);
  v1.nodes.forEach(n => { const d = draft.nodes.find(x => x.id === n.id)!; n.x = d.x; n.y = d.y; });
  return {
    code: 'PB-002', name: 'Phishing email', category: 'Phishing', severity: 'Medium',
    description: 'A user reports a suspicious email. Qualify it, purge it everywhere and check who clicked.',
    versions: [{ date: '2026-05-20T08:00:00Z', author: 'Inès B.', msg: 'Initial version', graph: v1 }],
    draft
  };
}

function one(code: string, name: string, category: string, severity: Severity, description: string, date: string, author: string, g: Graph): SeedPlaybook {
  return { code, name, category, severity, description, versions: [{ date, author, msg: 'Initial version', graph: g }], draft: clone(g) };
}

const accountCompromise = () => one('PB-003', 'Compromised account', 'Identity', 'High',
  'Suspicious sign-in or confirmed takeover of a user account. Cut access, scope what the attacker did, restore safely.',
  '2026-04-02T09:00:00Z', 'Camille R.', aim(build([
    ['start', 'start', 'Suspicious sign-in alert', 'Detection'],
    ['triage', 'action', 'Review the sign-in', 'Detection', 'L1 Analyst', 15, 'Look at location, device, client and MFA events around the alert.', ['Check impossible travel and unfamiliar devices', 'Review MFA prompts and approvals', 'Confirm with the user by phone, not email']],
    ['confirmed', 'decision', 'Compromise confirmed?', 'Detection', 'L1 Analyst', 10],
    ['fp', 'action', 'Close as false positive', D, 'L1 Analyst', 10, '', ['Document the evidence', 'Tune the detection rule if needed']],
    ['contain', 'action', 'Contain the account', 'Containment', 'L2 Analyst', 15, 'Kick the attacker out before scoping.', ['Block sign-in', 'Revoke sessions and refresh tokens', 'Reset password and remove unknown MFA methods']],
    ['scope', 'action', 'Scope attacker activity', 'Eradication', 'L2 Analyst', 120, '', ['Inbox rules and forwarding', 'OAuth app consents', 'Files accessed or shared externally', 'Privilege or group changes']],
    ['priv', 'decision', 'Privileged or sensitive access?', 'Eradication', 'L2 Analyst', 10],
    ['escalate', 'escalation', 'Escalate to the IR lead', 'Eradication', 'IR Lead', 30, 'Treat as a major incident.', ['Open a major incident', 'Assess data exposure with the DPO', 'Check other accounts for the same pattern']],
    ['restore', 'action', 'Restore and monitor', 'Recovery', 'L2 Analyst', 60, '', ['Re-enable with new credentials and MFA', 'Add a 14-day monitoring rule', 'Brief the user']],
    ['review', 'action', 'Post-incident review', D, 'IR Lead', 60, '', ['Record the root cause', 'List corrective actions']],
    ['end', 'end', 'Incident closed', D]
  ], [['start', 'triage'], ['triage', 'confirmed'], ['confirmed', 'contain', 'Yes'], ['confirmed', 'fp', 'No'], ['fp', 'end'], ['contain', 'scope'], ['scope', 'priv'], ['priv', 'escalate', 'Yes'], ['priv', 'restore', 'No'], ['escalate', 'restore'], ['restore', 'review'], ['review', 'end']]), { triage: { targets: ['affected', 'contacts:affected'] }, confirmed: { targets: ['suspected'], effects: { Yes: ['compromised', 'suspected'] } }, contain: { targets: ['compromised', 'flows:compromised'] }, scope: { targets: ['compromised', 'reach:compromised'] }, escalate: { targets: ['business:affected', 'contacts:is'] }, restore: { targets: ['compromised'] } }));

const ceoFraud = () => one('PB-004', 'CEO fraud and payment diversion', 'Fraud', 'High',
  'Urgent payment request or changed bank details from a fake executive or supplier. Stop the money first.',
  '2026-04-15T13:00:00Z', 'Inès B.', build([
    ['start', 'start', 'Suspicious payment request', 'Detection'],
    ['verify', 'action', 'Verify the request', 'Detection', 'Finance', 15, 'Never reply to the email. Call back on a number you already know.', ['Call the requester on a known number', 'Check recent bank detail changes for the supplier', 'Keep the original email as evidence']],
    ['sent', 'decision', 'Payment already sent?', 'Containment', 'Finance', 5],
    ['recall', 'escalation', 'Request a payment recall', 'Containment', 'Finance', 30, 'Speed matters: recalls succeed mostly within the first hours.', ['Call the bank fraud desk', 'Request a SWIFT or SEPA recall', 'File a police report']],
    ['block', 'action', 'Block the transaction', 'Containment', 'Finance', 15, '', ['Freeze the pending payment', 'Flag the supplier record']],
    ['mailbox', 'action', 'Investigate the mailbox', 'Eradication', 'L2 Analyst', 90, '', ['Tell spoofing from a compromised account', 'Search for similar emails', 'Block the sender domain']],
    ['internal', 'decision', 'Internal mailbox compromised?', 'Eradication', 'L2 Analyst', 10],
    ['account', 'action', 'Run the compromised account playbook', 'Eradication', 'L2 Analyst', 30, 'Start PB-003 for each affected mailbox.', ['Declare PB-003 incidents', 'Reset the affected credentials']],
    ['warn', 'action', 'Warn finance and suppliers', 'Recovery', 'Communications', 60, '', ['Alert the finance team', 'Notify the impersonated supplier']],
    ['review', 'action', 'Post-incident review', D, 'IR Lead', 60, '', ['Review payment approval controls', 'Plan an awareness reminder']],
    ['end', 'end', 'Incident closed', D]
  ], [['start', 'verify'], ['verify', 'sent'], ['sent', 'recall', 'Yes'], ['sent', 'block', 'No'], ['recall', 'mailbox'], ['block', 'mailbox'], ['mailbox', 'internal'], ['internal', 'account', 'Yes'], ['internal', 'warn', 'No'], ['account', 'warn'], ['warn', 'review'], ['review', 'end']]));

const dataBreach = () => one('PB-005', 'Personal data breach', 'Data protection', 'High',
  'Personal data exposed, lost or accessed without authorisation. Contain, assess the risk, notify within 72 hours when required.',
  '2026-05-02T10:00:00Z', 'Camille R.', build([
    ['start', 'start', 'Possible data breach detected', 'Detection'],
    ['contain', 'action', 'Stop the exposure', 'Containment', 'L2 Analyst', 30, 'Record when the breach was discovered: the 72-hour clock starts there.', ['Revoke links, close the bucket or disable the account', 'Preserve logs and evidence', 'Record the discovery time']],
    ['assess', 'action', 'Assess the breach', 'Eradication', 'DPO', 240, '', ['Identify data categories and number of people', 'Assess the risk to individuals', 'Log it in the breach register']],
    ['risk', 'decision', 'Risk to individuals?', 'Eradication', 'DPO', 30],
    ['register', 'action', 'Document in the register', D, 'DPO', 60, '', ['Record the reasoning for not notifying']],
    ['notify', 'escalation', 'Notify the CNIL', 'Recovery', 'DPO', 4320, 'Within 72 hours of discovery. Send what you know and follow up.', ['File the notification', 'Plan follow-up information']],
    ['high', 'decision', 'High risk to individuals?', 'Recovery', 'DPO', 60],
    ['inform', 'action', 'Inform affected people', 'Recovery', 'Communications', 1440, '', ['Write a plain-language notice', 'Send it through a known channel', 'Set up a support contact']],
    ['review', 'action', 'Post-incident review', D, 'DPO', 120, '', ['Root cause and corrective actions', 'Update the register']],
    ['end', 'end', 'Incident closed', D]
  ], [['start', 'contain'], ['contain', 'assess'], ['assess', 'risk'], ['risk', 'notify', 'Yes'], ['risk', 'register', 'No'], ['register', 'end'], ['notify', 'high'], ['high', 'inform', 'Yes'], ['high', 'review', 'No'], ['inform', 'review'], ['review', 'end']]));

const malware = () => one('PB-006', 'Malware on an endpoint', 'Malware', 'Medium',
  'EDR or antivirus alert on a workstation or server. Check execution, contain, hunt for spread.',
  '2026-03-28T08:30:00Z', 'Noah L.', aim(build([
    ['start', 'start', 'EDR malware alert', 'Detection'],
    ['triage', 'action', 'Triage the detection', 'Detection', 'L1 Analyst', 15, '', ['Check the file hash reputation', 'Identify the user and host', 'Check whether the EDR blocked it']],
    ['ran', 'decision', 'Did the malware run?', 'Detection', 'L1 Analyst', 10],
    ['clean', 'action', 'Clean and close', D, 'L1 Analyst', 20, '', ['Quarantine the file', 'Run a full scan', 'Document the verdict']],
    ['isolate', 'action', 'Isolate the endpoint', 'Containment', 'L1 Analyst', 10, '', ['Network-isolate through the EDR', 'Tell the user what is happening']],
    ['analyse', 'action', 'Analyse the sample', 'Eradication', 'L2 Analyst', 120, '', ['Detonate in the sandbox', 'Extract IOCs and C2 domains']],
    ['hunt', 'action', 'Hunt across the fleet', 'Eradication', 'L2 Analyst', 180, '', ['Search IOCs in EDR and SIEM', 'Block hashes and domains']],
    ['spread', 'decision', 'Other hosts infected?', 'Eradication', 'L2 Analyst', 10],
    ['escalate', 'escalation', 'Escalate to the IR lead', 'Eradication', 'IR Lead', 30, '', ['Open a major incident', 'Consider the ransomware playbook']],
    ['reimage', 'action', 'Reimage affected hosts', 'Recovery', 'IT support', 240, '', ['Back up user data', 'Reimage from the standard image', 'Reset user credentials']],
    ['review', 'action', 'Post-incident review', D, 'IR Lead', 60, '', ['Identify the delivery vector', 'List corrective actions']],
    ['end', 'end', 'Incident closed', D]
  ], [['start', 'triage'], ['triage', 'ran'], ['ran', 'isolate', 'Yes'], ['ran', 'clean', 'No'], ['clean', 'end'], ['isolate', 'analyse'], ['analyse', 'hunt'], ['hunt', 'spread'], ['spread', 'escalate', 'Yes'], ['spread', 'reimage', 'No'], ['escalate', 'reimage'], ['reimage', 'review'], ['review', 'end']]), { triage: { targets: ['affected', 'contacts:affected'] }, ran: { targets: ['suspected'], effects: { Yes: ['compromised', 'suspected'] } }, isolate: { targets: ['compromised', 'flows:compromised'] }, analyse: { targets: ['compromised'] }, hunt: { targets: ['reach:compromised'] }, spread: { targets: ['reach:compromised'] }, escalate: { targets: ['business:affected', 'contacts:is'] }, reimage: { targets: ['compromised', 'consumers:compromised'] } }));

const ddos = () => one('PB-007', 'DDoS attack', 'Availability', 'High',
  'A public service slows down or goes offline under abnormal traffic. Confirm, mitigate upstream, keep customers informed.',
  '2026-06-11T15:00:00Z', 'Noah L.', build([
    ['start', 'start', 'Service degradation alert', 'Detection'],
    ['confirm', 'action', 'Confirm the attack', 'Detection', 'Network engineer', 15, '', ['Check traffic graphs and sources', 'Rule out a deployment or a legitimate spike', 'Identify the targeted service']],
    ['volum', 'decision', 'Volumetric attack?', 'Containment', 'Network engineer', 10, 'Volumetric: saturates bandwidth. Otherwise treat it as application layer.'],
    ['upstream', 'action', 'Activate upstream mitigation', 'Containment', 'Network engineer', 15, '', ['Call the ISP or scrubbing provider', 'Enable cloud DDoS protection', 'Route DNS through mitigation']],
    ['waf', 'action', 'Filter at the application layer', 'Containment', 'Network engineer', 30, '', ['Rate-limit on the WAF', 'Block abusive IPs and ASNs', 'Enable a challenge page']],
    ['comms', 'action', 'Inform customers', 'Containment', 'Communications', 30, '', ['Update the status page', 'Brief customer support']],
    ['restored', 'decision', 'Service restored?', 'Recovery', 'Network engineer', 60],
    ['crisis', 'escalation', 'Escalate to the crisis cell', 'Recovery', 'CISO', 30, '', ['Brief leadership', 'Decide on failover or degraded mode']],
    ['review', 'action', 'Post-incident review', D, 'IR Lead', 60, '', ['Capture traffic metrics', 'Review mitigation contracts']],
    ['end', 'end', 'Incident closed', D]
  ], [['start', 'confirm'], ['confirm', 'volum'], ['volum', 'upstream', 'Yes'], ['volum', 'waf', 'No'], ['upstream', 'comms'], ['waf', 'comms'], ['comms', 'restored'], ['restored', 'review', 'Yes'], ['restored', 'crisis', 'No'], ['crisis', 'review'], ['review', 'end']]));

const lostDevice = () => one('PB-008', 'Lost or stolen device', 'Device', 'Medium',
  'A laptop, phone or token is lost or stolen. Lock it, wipe it, check what data was on it.',
  '2026-02-20T11:00:00Z', 'Inès B.', build([
    ['start', 'start', 'Device reported lost', 'Detection'],
    ['details', 'action', 'Collect the details', 'Detection', 'IT support', 15, '', ['Device type and serial number', 'Last known place and time', 'Data and access on the device', 'Police report number if stolen']],
    ['enc', 'decision', 'Disk encrypted?', 'Containment', 'IT support', 10],
    ['exposure', 'escalation', 'Assess data exposure', 'Containment', 'DPO', 240, 'An unencrypted device may count as a personal data breach.', ['List the data stored locally', 'Decide whether to start PB-005']],
    ['wipe', 'action', 'Lock and wipe remotely', 'Containment', 'IT support', 30, '', ['Remote lock through MDM', 'Remote wipe', 'Revoke device certificates and tokens']],
    ['creds', 'action', 'Reset credentials', 'Eradication', 'IT support', 30, '', ['Reset the user password', 'Re-register MFA']],
    ['replace', 'action', 'Replace the device', 'Recovery', 'IT support', 1440, '', ['Issue a new device', 'Restore the user profile']],
    ['end', 'end', 'Incident closed', D]
  ], [['start', 'details'], ['details', 'enc'], ['enc', 'wipe', 'Yes'], ['enc', 'exposure', 'No'], ['exposure', 'wipe'], ['wipe', 'creds'], ['creds', 'replace'], ['replace', 'end']]));

const insider = () => one('PB-009', 'Insider threat', 'Insider', 'High',
  'An employee or contractor may be stealing data or sabotaging systems. Stay discreet and work with HR and Legal.',
  '2026-07-08T09:30:00Z', 'Camille R.', build([
    ['start', 'start', 'Suspicious insider activity', 'Detection'],
    ['triage', 'action', 'Discreet triage', 'Detection', 'L2 Analyst', 60, 'Keep this need-to-know. Do not alert the person.', ['Review DLP and access logs', 'Limit who knows about the case']],
    ['hr', 'escalation', 'Involve HR and Legal', 'Detection', 'IR Lead', 240, '', ['Open a confidential case', 'Confirm the legal basis for the investigation', 'Agree on next steps']],
    ['evidence', 'action', 'Collect evidence', 'Eradication', 'L2 Analyst', 480, '', ['Preserve logs and mailbox', 'Image devices with legal approval', 'Keep a chain of custody']],
    ['confirmed', 'decision', 'Malicious activity confirmed?', 'Eradication', 'IR Lead', 60],
    ['closeq', 'action', 'Close discreetly', D, 'HR', 60, '', ['Record the outcome in the confidential case']],
    ['revoke', 'action', 'Revoke access', 'Containment', 'Sysadmin', 30, 'Coordinate the timing with HR.', ['Disable accounts at the agreed time', 'Collect badge and devices', 'Rotate shared secrets']],
    ['loss', 'action', 'Assess data loss', 'Recovery', 'DPO', 480, '', ['List data taken or destroyed', 'Decide whether to start PB-005']],
    ['review', 'action', 'Post-incident review', D, 'IR Lead', 120, '', ['Review access controls', 'Review offboarding process']],
    ['end', 'end', 'Case closed', D]
  ], [['start', 'triage'], ['triage', 'hr'], ['hr', 'evidence'], ['evidence', 'confirmed'], ['confirmed', 'revoke', 'Yes'], ['confirmed', 'closeq', 'No'], ['closeq', 'end'], ['revoke', 'loss'], ['loss', 'review'], ['review', 'end']]));

const vuln = () => one('PB-010', 'Exploited critical vulnerability', 'Vulnerability', 'Critical',
  'A critical flaw in a product you run is exploited in the wild. Find exposure, mitigate, hunt for compromise.',
  '2026-08-21T07:45:00Z', 'Noah L.', aim(build([
    ['start', 'start', 'Critical vulnerability exploited', 'Detection'],
    ['exposure', 'action', 'Identify exposed assets', 'Detection', 'L2 Analyst', 60, '', ['Match the affected product and versions', 'Check internet exposure', 'List system owners']],
    ['found', 'decision', 'Exposed assets found?', 'Detection', 'L2 Analyst', 10],
    ['doc', 'action', 'Document and monitor', D, 'L1 Analyst', 30, '', ['Record that no asset is affected', 'Watch vendor updates']],
    ['mitigate', 'action', 'Apply mitigation', 'Containment', 'Sysadmin', 120, '', ['Patch or apply the vendor workaround', 'Restrict access at the firewall', 'Enable virtual patching on WAF or IPS']],
    ['hunt', 'action', 'Hunt for compromise', 'Eradication', 'L2 Analyst', 240, '', ['Search the vendor IOCs', 'Review logs since disclosure', 'Look for web shells and new accounts']],
    ['comp', 'decision', 'Signs of compromise?', 'Eradication', 'L2 Analyst', 30],
    ['major', 'escalation', 'Open a major incident', 'Eradication', 'IR Lead', 30, '', ['Start the intrusion or ransomware playbook', 'Preserve evidence']],
    ['review', 'action', 'Post-incident review', D, 'IR Lead', 60, '', ['Measure time to patch', 'Review asset inventory gaps']],
    ['end', 'end', 'Incident closed', D]
  ], [['start', 'exposure'], ['exposure', 'found'], ['found', 'mitigate', 'Yes'], ['found', 'doc', 'No'], ['doc', 'end'], ['mitigate', 'hunt'], ['hunt', 'comp'], ['comp', 'major', 'Yes'], ['comp', 'review', 'No'], ['major', 'review'], ['review', 'end']]), { exposure: { targets: ['vuln:{cve}', 'contacts:vuln:{cve}'] }, found: { targets: ['vuln:{cve}'], effects: { Yes: ['suspected', 'vuln:{cve}'] } }, mitigate: { targets: ['vuln:{cve}', 'flows:vuln:{cve}'] }, hunt: { targets: ['vuln:{cve}', 'reach:vuln:{cve}'] }, comp: { targets: ['vuln:{cve}'], effects: { Yes: ['compromised', 'vuln:{cve}'] } }, major: { targets: ['business:affected', 'contacts:affected'] } }));

export function defaultPlaybooks(): SeedPlaybook[] {
  return [ransomware(), phishing(), accountCompromise(), ceoFraud(), dataBreach(), malware(), ddos(), lostDevice(), insider(), vuln()];
}
