import { useEffect, useRef, useState } from 'react';
import { api, features, type Me } from '@muster/backend';
import { MeCtx, useRoute, go, can, startEvents, stopEvents, useChanges, useLoad, Loading, Brand, initials, useNow, ThemeCtx, useThemeState, useTheme, ThemeToggle, type ThemePref } from './lib';
import { Login } from './views/Login';
import { Library } from './views/Library';
import { PlaybookEditor } from './views/Editor';
import { PlaybookHistory } from './views/History';
import { Incidents } from './views/Incidents';
import { IncidentRun } from './views/IncidentRun';
import { Reports } from './views/Reports';
import { Admin } from './views/Admin';
import { Account } from './views/Account';

export function App() {
  const theme = useThemeState();
  return <ThemeCtx.Provider value={theme}><Root /></ThemeCtx.Provider>;
}

function Root() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => { api.me().then(r => setMe(r.user)).catch(() => setMe(null)); }, []);
  useEffect(() => {
    const on = () => { setMe(null); stopEvents(); };
    window.addEventListener('muster:signed-out', on);
    return () => window.removeEventListener('muster:signed-out', on);
  }, []);
  useEffect(() => { if (me) startEvents(); }, [me]);
  if (me === undefined) return <Loading />;
  if (!me) return features.localAuth ? <Login onSignedIn={setMe} /> : <NoAccess />;
  return <MeCtx.Provider value={me}><Shell me={me} onSignedOut={() => { stopEvents(); setMe(null); }} /></MeCtx.Provider>;
}

function Shell({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const route = useRoute();
  const theme = useTheme();
  const themeRef = useRef(theme); themeRef.current = theme;
  const section = route[0];
  const incidents = useLoad(() => api.incidents(), []);
  useChanges(c => { if (c.type === 'incident') incidents.reload(); });
  const active = (incidents.data || []).filter(i => i.status === 'active').length;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input,textarea,select,[contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('.modal')) return;
      if (e.shiftKey && e.key.toLowerCase() === 'd') { e.preventDefault(); themeRef.current.setPref(themeRef.current.dark ? 'light' : 'dark'); return; }
      const dest = { '1': 'playbooks', '2': 'incidents', '3': 'reports', '4': features.admin && can(me, 'admin') ? 'admin' : '' }[e.key];
      if (dest) { e.preventDefault(); go(dest); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [me]);

  let view;
  if (section === 'playbooks' && route[1] && route[2] === 'history') view = <PlaybookHistory id={route[1]} />;
  else if (section === 'playbooks' && route[1]) view = <PlaybookEditor id={route[1]} />;
  else if (section === 'incidents' && route[1]) view = <IncidentRun id={route[1]} />;
  else if (section === 'incidents') view = <Incidents />;
  else if (section === 'reports') view = <Reports sel={route[1] === 'templates' ? { kind: 'tpl', id: route[2] } : route[1] ? { kind: 'report', id: route[1] } : null} />;
  else if (section === 'admin' && features.admin && can(me, 'admin')) view = <Admin />;
  else if (section === 'account' && features.localAuth) view = <Account />;
  else view = <Library />;

  const nav = [
    { k: 'playbooks', label: 'Playbooks', n: '1' },
    { k: 'incidents', label: 'Incidents', n: '2', live: active > 0 },
    { k: 'reports', label: 'Reports', n: '3' },
    ...(features.admin && can(me, 'admin') ? [{ k: 'admin', label: 'Admin', n: '4' }] : [])
  ];
  return (
    <div className="shell">
      <header className="bar">
        <Brand />
        <nav className="nav" aria-label="Main">
          {nav.map(x => (
            <a key={x.k} href={'#/' + x.k} aria-current={section === x.k || (x.k === 'playbooks' && !nav.some(n => n.k === section) && section !== 'account') ? 'page' : undefined}>
              <span className="tn">{x.n}</span>{x.label}{x.live && <span className="live-dot" title={`${active} active`} />}
            </a>
          ))}
        </nav>
        <div className="bar-r">
          <Utc />
          <ThemeToggle />
          <UserMenu me={me} onSignedOut={onSignedOut} />
        </div>
      </header>
      <main className="view">{view}</main>
    </div>
  );
}

function Utc() {
  const now = useNow(1000);
  return <span className="utc" aria-label="Current time in UTC">{new Date(now).toISOString().slice(11, 19)} UTC</span>;
}

function UserMenu({ me, onSignedOut }: { me: Me; onSignedOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="who" ref={ref}>
      <button className="who-btn" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(o => !o)}>
        <span className="avatar">{initials(me.name)}</span>{me.name.split(' ')[0]}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="mh"><b>{me.name}</b><small>{features.localAuth ? me.username + ' · ' : ''}{ROLE_LABEL[me.role]}</small></div>
          <div className="lbl">Theme</div>
          <ThemeChoice />
          {features.localAuth ? <>
            <a role="menuitem" href="#/account" onClick={() => setOpen(false)}>Change password</a>
            <button role="menuitem" onClick={async () => { try { await api.logout(); } finally { onSignedOut(); } }}>Sign out</button>
          </> : <p className="foot" style={{ padding: '4px 10px 8px', maxWidth: 240 }}>Your role comes from this page's sharing settings in Claude. Editors manage playbooks and templates; contributors run incidents and write reports.</p>}
        </div>
      )}
    </div>
  );
}

const ROLE_LABEL: Record<string, string> = { viewer: 'Viewer', analyst: 'Analyst', editor: 'Editor', admin: 'Admin' };

function NoAccess() {
  return (
    <div className="loading" style={{ minHeight: '100vh', padding: 24 }}>
      <div className="panel" style={{ maxWidth: 460 }}>
        <div className="panel-h"><h3>Muster can't load here</h3></div>
        <div className="panel-b"><p style={{ margin: 0 }}>This view has no access to the shared playbook data. Open the page in Claude while signed in, or ask its owner to share it with you.</p></div>
      </div>
    </div>
  );
}

function ThemeChoice() {
  const { pref, setPref } = useTheme();
  const opts: [ThemePref, string][] = [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']];
  return <div className="seg3" role="group" aria-label="Theme">{opts.map(([k, l]) => <button key={k} aria-pressed={pref === k} onClick={() => setPref(k)}>{l}</button>)}</div>;
}
