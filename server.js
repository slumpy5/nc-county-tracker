'use strict';

const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'counties.db');

if (process.env.NODE_ENV === 'production' && !process.env.DB_PATH) {
  console.warn('WARNING: DB_PATH not set — data will be lost on redeploy. Set DB_PATH to your Render Disk mount path (e.g. /data/counties.db).');
}

console.log(`Using database at: ${DB_PATH}`);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS counties (
    fips       TEXT PRIMARY KEY,
    status     TEXT,
    notes      TEXT,
    locked     INTEGER DEFAULT 0,
    mobilize   TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

try {
  db.exec('ALTER TABLE counties ADD COLUMN locked INTEGER DEFAULT 0');
} catch (err) {
  // column already exists
}

try {
  db.exec('ALTER TABLE counties ADD COLUMN mobilize TEXT');
} catch (err) {
  // column already exists
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: DB_PATH });
});

// Return all county assignments
app.get('/api/counties', (req, res) => {
  const rows = db.prepare('SELECT fips, status, notes, locked, mobilize FROM counties').all();
  const out = {};
  for (const row of rows) {
    out[row.fips] = { status: row.status || null, notes: row.notes || '', locked: !!row.locked, mobilize: row.mobilize || '' };
  }
  res.json(out);
});

// Save / update one county
app.post('/api/county', (req, res) => {
  console.log('POST /api/county body:', JSON.stringify(req.body));
  try {
    const { fips, status, notes, locked, mobilize } = req.body || {};
    if (!fips || !/^\d{5}$/.test(fips)) {
      return res.status(400).json({ error: `invalid fips: ${fips}` });
    }
    db.prepare(`
      INSERT INTO counties (fips, status, notes, locked, mobilize, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(fips) DO UPDATE SET
        status     = excluded.status,
        notes      = excluded.notes,
        locked     = excluded.locked,
        mobilize   = excluded.mobilize,
        updated_at = excluded.updated_at
    `).run(fips, status || null, notes || null, locked ? 1 : 0, mobilize || null);
    console.log('Saved county:', fips, status);
    res.json({ ok: true });
  } catch (err) {
    console.error('Save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NC County Tracker on port ${PORT}`));
