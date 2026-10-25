// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react';
import { api, type Me } from '@muster/backend';

export function Login({ onSignedIn }: { onSignedIn: (m: Me) => void }) {
  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState<{ username: string; password: string; role: string }[]>([]);
  useEffect(() => { api.config().then(c => setDemo(c.demoAccounts)).catch(() => {}); }, []);

  const signIn = async (u = username, p = password) => {
    setBusy(true); setError(null);
    try { const r = await api.login(u, p); onSignedIn(r.user); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="login">
      <section className="login-l">
        <a className="brand" href="#/" style={{ color: '#fff' }}>
          <svg viewBox="0 0 22 22" aria-hidden="true"><rect x="1" y="1" width="20" height="20" rx="5" fill="#fff" /><path d="M5.5 15.5 V7 L11 12 L16.5 7 V15.5" fill="none" stroke="#121413" strokeWidth="2" strokeLinecap="square" /><circle cx="11" cy="16" r="1.9" fill="#FF5A1F" /></svg>
          Muster
        </a>
        <div>
          <h1>Know the next step <em>before</em> the incident.</h1>
          <p>Write response playbooks as diagrams, run them step by step when it counts, and hand over a clean report when it's over.</p>
        </div>
        <div className="phases" aria-hidden="true">
          {['Detection', 'Containment', 'Eradication', 'Recovery', 'Lessons'].map(p => <div key={p}>{p}</div>)}
        </div>
      </section>
      <section className="login-r">
        <form className="login-card" onSubmit={e => { e.preventDefault(); signIn(); }}>
          <div><span className="code">Security operations</span><h2 style={{ marginTop: 6 }}>Sign in</h2></div>
          {error && <div className="err-banner" role="alert">{error}</div>}
          <label className="field">Username<input className="inp" id="login-user" autoComplete="username" value={username} onChange={e => setU(e.target.value)} required autoFocus /></label>
          <label className="field">Password<input className="inp" id="login-pass" type="password" autoComplete="current-password" value={password} onChange={e => setP(e.target.value)} required /></label>
          <button className="btn primary lg" disabled={busy || !username || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
          {demo.length > 0 && (
            <div className="demo">
              <div className="dh"><span>Demo accounts</span><span className="code">click to sign in</span></div>
              {demo.map(d => (
                <button type="button" key={d.username} onClick={() => { setU(d.username); setP(d.password); signIn(d.username, d.password); }}>
                  <span className="u">{d.username}</span><span className="p">{d.password}</span><span className="tag line">{d.role}</span>
                </button>
              ))}
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
