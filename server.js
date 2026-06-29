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
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: DB_PATH });
});

// Return all county assignments
app.get('/api/counties', (req, res) => {
  const rows = db.prepare('SELECT fips, status, notes FROM counties').all();
  const out = {};
  for (const row of rows) {
    out[row.fips] = { status: row.status || null, notes: row.notes || '' };
  }
  res.json(out);
});

// Save / update one county
app.post('/api/county', (req, res) => {
  const { fips, status, notes } = req.body || {};
  if (!fips || !/^\d{5}$/.test(fips)) {
    return res.status(400).json({ error: 'invalid fips' });
  }
  db.prepare(`
    INSERT INTO counties (fips, status, notes, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(fips) DO UPDATE SET
      status     = excluded.status,
      notes      = excluded.notes,
      updated_at = excluded.updated_at
  `).run(fips, status || null, notes || null);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NC County Tracker on port ${PORT}`));
