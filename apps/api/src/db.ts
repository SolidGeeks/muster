import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Storage layer. Everything that touches SQL lives here, so moving to PostgreSQL
 * means rewriting this file only. Complex objects are stored as JSON columns.
 */
export class Store {
  db: DatabaseSync;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
        role TEXT NOT NULL, pw_hash TEXT NOT NULL, disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS playbooks (
        id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT NOT NULL, severity TEXT NOT NULL,
        description TEXT NOT NULL, draft TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1, archived INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL, updated_by TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS versions (
        playbook_id TEXT NOT NULL REFERENCES playbooks(id) ON DELETE CASCADE, v INTEGER NOT NULL, date TEXT NOT NULL,
        author TEXT NOT NULL, msg TEXT NOT NULL, graph TEXT NOT NULL, PRIMARY KEY (playbook_id, v)
      );
      CREATE TABLE IF NOT EXISTS incidents (
        id TEXT PRIMARY KEY, ref TEXT NOT NULL UNIQUE, status TEXT NOT NULL, data TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1,
        started_at INTEGER NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY, num TEXT NOT NULL, incident_id TEXT, data TEXT NOT NULL, created TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS templates (
        id TEXT PRIMARY KEY, data TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user TEXT NOT NULL, action TEXT NOT NULL,
        target TEXT NOT NULL, detail TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_incidents_started ON incidents(started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(id DESC);
    `);
  }

  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  all<T = any>(sql: string, ...args: any[]): T[] { return this.db.prepare(sql).all(...args) as T[]; }
  get<T = any>(sql: string, ...args: any[]): T | undefined { return this.db.prepare(sql).get(...args) as T | undefined; }
  run(sql: string, ...args: any[]) { return this.db.prepare(sql).run(...args); }

  getMeta(key: string): string | undefined { return this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)?.value; }
  setMeta(key: string, value: string) { this.run('INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value); }

  nextCounter(name: string, start = 1): number {
    const row = this.get<{ value: number }>('SELECT value FROM counters WHERE name = ?', name);
    const v = row ? row.value + 1 : start;
    this.run('INSERT INTO counters(name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value', name, v);
    return v;
  }

  audit(user: string, action: string, target: string, detail = '') {
    this.run('INSERT INTO audit(at, user, action, target, detail) VALUES (?, ?, ?, ?, ?)', new Date().toISOString(), user, action, target, detail.slice(0, 500));
  }
}
