import { useState } from 'react';
import { api } from '@muster/backend';
import { useMe, useToast } from '../lib';

export function Account() {
  const me = useMe();
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = again.length > 0 && next !== again;
  return (
    <div className="page">
      <div className="page-in" style={{ maxWidth: 520 }}>
        <div className="ph"><div><span className="code">{me.username} · {me.role}</span><h1>Your account</h1><p>Changing your password signs you out everywhere else.</p></div></div>
        <form className="panel" onSubmit={async e => {
          e.preventDefault(); setBusy(true); setErr(null);
          try { await api.changePassword(cur, next); toast('Password changed'); setCur(''); setNext(''); setAgain(''); }
          catch (e2) { setErr((e2 as Error).message); }
          finally { setBusy(false); }
        }}>
          <div className="panel-h"><h3>Change password</h3></div>
          <div className="panel-b">
            {err && <div className="errbox" role="alert">{err}</div>}
            <label className="field">Current password<input className="inp" type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} required /></label>
            <label className="field">New password<input className="inp" type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} required minLength={10} /><span className="hint">At least 10 characters.</span></label>
            <label className="field">Repeat the new password<input className="inp" type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} required />{mismatch && <span className="hint" style={{ color: 'var(--crit)' }}>The two passwords don't match.</span>}</label>
            <div><button className="btn primary" disabled={busy || !cur || next.length < 10 || next !== again}>{busy ? 'Saving…' : 'Change password'}</button></div>
          </div>
        </form>
      </div>
    </div>
  );
}
