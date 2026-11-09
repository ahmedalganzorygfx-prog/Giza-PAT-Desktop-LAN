'use strict';
const express = require('express');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function mergeById(base, incoming, current) {
  if (![base, incoming, current].every(Array.isArray) ||
      ![...base, ...incoming, ...current].every(x => x && typeof x === 'object' && Number.isFinite(Number(x.id)))) return incoming;
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const baseMap = new Map(base.map(x => [String(x.id), x]));
  const incomingMap = new Map(incoming.map(x => [String(x.id), x]));
  const currentMap = new Map(current.map(x => [String(x.id), x]));
  const merged = new Map();
  // Start with current server state, then apply only the client's changes relative to its base snapshot.
  for (const [id, live] of currentMap) {
    if (!baseMap.has(id)) { merged.set(id, live); continue; } // another client added it
    if (!incomingMap.has(id)) {
      if (!same(live, baseMap.get(id))) merged.set(id, live); // don't erase a concurrent edit
      continue; // deletion requested and no concurrent edit
    }
    const proposed = incomingMap.get(id);
    merged.set(id, same(proposed, baseMap.get(id)) ? live : proposed);
  }
  let nextId = Math.max(0, ...[...merged.values(), ...incoming].map(x => Number(x.id)||0));
  for (const [id, proposed] of incomingMap) {
    if (baseMap.has(id)) continue;
    if (!merged.has(id)) merged.set(id, proposed);
    else {
      // Two clients may generate the same next numeric ID simultaneously. Preserve both records.
      const replacement = { ...proposed, id: ++nextId };
      merged.set(String(replacement.id), replacement);
    }
  }
  return [...merged.values()].sort((a,b) => Number(a.id)-Number(b.id));
}

function startServer(options = {}) {
  const dataDir = options.dataDir || process.env.GIZA_DATA_DIR || path.join(__dirname, 'data');
  const port = Number(options.port || process.env.GIZA_PORT || 8765);
  const token = options.token || process.env.GIZA_TOKEN || 'GIZA-PAT-CHANGE-THIS-KEY';
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'giza_pat_central.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 10000');
  db.exec(`CREATE TABLE IF NOT EXISTS app_storage (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  const app = express();
  app.disable('x-powered-by');
  app.use((req,res,next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.text({ type: '*/*', limit: '30mb' }));
  const authorized = (req,res,next) => {
    if (req.query.token !== token) return res.status(401).json({error:'Unauthorized'});
    next();
  };
  app.get('/api/health', (req,res) => res.json({ok:true, service:'Giza PAT Central Service', version:'1.0.0'}));
  app.get('/api/storage', authorized, (req,res) => {
    const rows = db.prepare('SELECT key,value FROM app_storage').all();
    const data = {}; for (const row of rows) data[row.key] = row.value;
    res.json(data);
  });
  app.get('/api/storage/:key', authorized, (req,res) => {
    const row = db.prepare('SELECT value FROM app_storage WHERE key=?').get(req.params.key);
    res.json({value: row ? row.value : null});
  });
  app.post('/api/storage/:key', authorized, (req,res) => {
    const key = req.params.key;
    if (!/^sp_[a-zA-Z0-9_-]{1,100}$/.test(key)) return res.status(400).json({error:'Invalid key'});
    let payload; try { payload = JSON.parse(req.body || '{}'); } catch { return res.status(400).json({error:'Invalid JSON'}); }
    if (typeof payload.value !== 'string') return res.status(400).json({error:'Invalid value'});
    const write = db.transaction(() => {
      const row = db.prepare('SELECT value FROM app_storage WHERE key=?').get(key);
      let finalValue = payload.value;
      if (row && typeof payload.base === 'string') {
        try {
          const base = JSON.parse(payload.base), incoming = JSON.parse(payload.value), current = JSON.parse(row.value);
          if (Array.isArray(base) && Array.isArray(incoming) && Array.isArray(current)) finalValue = JSON.stringify(mergeById(base,incoming,current));
        } catch {}
      }
      db.prepare(`INSERT INTO app_storage(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP`).run(key,finalValue);
      return finalValue;
    });
    const saved = write(); res.json({ok:true, value:saved});
  });
  app.delete('/api/storage/:key', authorized, (req,res) => {
    db.prepare('DELETE FROM app_storage WHERE key=?').run(req.params.key); res.json({ok:true});
  });
  app.delete('/api/storage', authorized, (req,res) => {
    db.prepare('DELETE FROM app_storage').run(); res.json({ok:true});
  });
  const backupDir = path.join(dataDir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  let backupBusy = false;
  async function backupDatabase() {
    if (backupBusy) return; backupBusy = true;
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await db.backup(path.join(backupDir, `central-${stamp}.db`));
      const old = fs.readdirSync(backupDir).filter(n => n.startsWith('central-') && n.endsWith('.db')).sort();
      for (const name of old.slice(0, Math.max(0, old.length - 30))) fs.unlinkSync(path.join(backupDir, name));
      console.log('Central database backup saved.');
    } catch (e) { console.error('Central database backup failed:', e.message); }
    finally { backupBusy = false; }
  }
  const backupTimer = setInterval(backupDatabase, 6 * 60 * 60 * 1000);
  backupTimer.unref();
  setTimeout(backupDatabase, 60 * 1000).unref();
  const server = app.listen(port, '0.0.0.0', () => console.log(`Giza PAT service listening on 0.0.0.0:${port}; data: ${dataDir}`));
  return { app, server, db, port, dataDir, close: () => { clearInterval(backupTimer); server.close(); db.close(); } };
}
if (require.main === module) startServer();
module.exports = { startServer };
