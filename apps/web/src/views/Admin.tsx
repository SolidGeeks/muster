// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react';
import type { Role, User } from '@muster/core';
import { api } from '@muster/backend';
import { useLoad, useMe, Loading, ErrorState, useToast, Modal, Icon } from '../lib';

const ROLES: { r: Role; d: string }[] = [
  { r: 'viewer', d: 'Reads playbooks, incidents and reports' },
  { r: 'analyst', d: 'Runs incidents and writes reports' },
  { r: 'editor', d: 'Edits and publishes playbooks and templates' },
  { r: 'admin', d: 'Manages users and sees the audit log' }
];

export function Admin() {
  const me = useMe();
  const toast = useToast();
  const users = useLoad(() => api.users(), []);
  const audit = useLoad(() => api.audit(), []);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<User | null>(null);

  const update = async (u: User, patch: { role?: Role; disabled?: boolean }) => {
    try { await api.updateUser(u.id, patch); toast(`${u.name} updated`); users.reload(); audit.reload(); }
    catch (e) { toast((e as Error).message, true); users.reload(); }
  };

  if (users.error) return <ErrorState message={users.error} onRetry={users.reload} />;
  if (!users.data) return <Loading label="Loading users" />;
  return (
    <div className="page">
      <div className="page-in">
        <div className="ph">
          <div><span className="code">Administration</span><h1>Users and audit</h1><p>Accounts are local to this Muster server. Changing a role or disabling an account signs that person out.</p></div>
          <button className="btn primary" onClick={() => setAdding(true)}>{Icon.plus}Add user</button>
        </div>
        <div className="two">
          <div className="panel">
            <div className="panel-h"><h3>Users</h3><span className="code">{users.data.length} accounts</span></div>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl">
                <thead><tr><th>Person</th><th>Role</th><th>Status</th><th className="r">Actions</th></tr></thead>
                <tbody>{users.data.map(u => (
                  <tr key={u.id}>
                    <td className="t"><b>{u.name}{u.id === me.id && <span className="code"> · you</span>}</b><small className="mono">{u.username}</small></td>
                    <td><select className="inp" style={{ height: 32, width: 'auto' }} value={u.role} aria-label={`Role of ${u.name}`} onChange={e => update(u, { role: e.target.value as Role })}>{ROLES.map(x => <option key={x.r} value={x.r}>{x.r}</option>)}</select></td>
                    <td>{u.disabled ? <span className="tag crit"><i />Disabled</span> : <span className="tag ok"><i />Active</span>}</td>
                    <td className="r"><div style={{ display: 'inline-flex', gap: 6 }}>
                      <button className="btn sm" onClick={() => setResetting(u)}>Reset password</button>
                      {u.id !== me.id && <button className="btn sm" onClick={() => update(u, { disabled: !u.disabled })}>{u.disabled ? 'Enable' : 'Disable'}</button>}
                    </div></td>
                  </tr>))}
                </tbody>
              </table>
            </div>
            <div className="panel-b" style={{ borderTop: '1px solid var(--rule)' }}>
              <div className="shortcuts">{ROLES.map(x => [<span key={x.r} className="role-tag">{x.r}</span>, <span key={x.r + 'd'}>{x.d}</span>])}</div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-h"><h3>Audit log</h3><button className="btn sm ghost" onClick={audit.reload}>Refresh</button></div>
            {audit.data ? <ul className="audit">{audit.data.map(a => (
              <li key={a.id}><time>{new Date(a.at).toISOString().slice(0, 16).replace('T', ' ')}</time><div><b>{a.user}</b> <span className="act">{a.action}</span><div>{a.target}{a.detail && <span style={{ color: 'var(--muted)' }}> · {a.detail}</span>}</div></div></li>))}
            </ul> : <Loading />}
          </div>
        </div>
      </div>
      {adding && <AddUser onClose={() => setAdding(false)} onDone={() => { setAdding(false); users.reload(); audit.reload(); }} />}
      {resetting && <ResetPassword user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function AddUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ username: '', name: '', role: 'analyst' as Role, password: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Add a user" kicker="Administration" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={async () => {
      setBusy(true); setErr(null);
      try { await api.createUser(f); toast(`${f.name} added`); onDone(); } catch (e) { setErr((e as Error).message); setBusy(false); }
    }}>Add user</button></>}>
      {err && <div className="errbox">{err}</div>}
      <div className="row2">
        <label className="field">Full name<input className="inp" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
        <label className="field">Username<input className="inp mono" value={f.username} onChange={e => setF({ ...f, username: e.target.value.toLowerCase() })} placeholder="e.g. jdupont" /></label>
      </div>
      <label className="field">Role<select className="inp" value={f.role} onChange={e => setF({ ...f, role: e.target.value as Role })}>{ROLES.map(x => <option key={x.r} value={x.r}>{x.r}: {x.d}</option>)}</select></label>
      <label className="field">Temporary password<input className="inp" type="text" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} placeholder="At least 10 characters" /></label>
      <p className="foot">Share the temporary password through a separate channel and ask the person to change it after signing in.</p>
    </Modal>
  );
}

function ResetPassword({ user, onClose }: { user: User; onClose: () => void }) {
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal title={`Reset ${user.name}'s password`} kicker="Administration" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={async () => {
      try { await api.updateUser(user.id, { password: pw }); toast('Password reset. Their sessions were signed out.'); onClose(); } catch (e) { setErr((e as Error).message); }
    }}>Reset password</button></>}>
      {err && <div className="errbox">{err}</div>}
      <label className="field">New temporary password<input className="inp" value={pw} onChange={e => setPw(e.target.value)} placeholder="At least 10 characters" /></label>
    </Modal>
  );
}
