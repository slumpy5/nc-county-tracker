'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const FIPS_TO_NAME = require('./counties.js');

const NAME_TO_FIPS = Object.fromEntries(
  Object.entries(FIPS_TO_NAME).map(([fips, name]) => [name, fips])
);

const SHEET_ID = process.env.SHEET_ID;
const SHEET_TAB = process.env.SHEET_TAB || '100 County Tracker';

if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY || !SHEET_ID) {
  console.warn('WARNING: GOOGLE_SERVICE_ACCOUNT_KEY and/or SHEET_ID not set — Sheets API calls will fail.');
}

const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY)
  : null;

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

// App status key <-> the exact text stored in column D ("Type of Launch")
const STATUS_SHEET_TEXT = {
  county_party:  'County Party',
  volunteer_led: 'Volunteer-Led',
  staff_doors:   'Staff Doors',
  partner:       'Partner',
};
const SHEET_TEXT_TO_STATUS = Object.fromEntries(
  Object.entries(STATUS_SHEET_TEXT).map(([status, text]) => [text, status])
);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, sheetId: SHEET_ID, tab: SHEET_TAB });
});

// Return all county assignments, read live from the sheet
app.get('/api/counties', async (req, res) => {
  try {
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${SHEET_TAB}'!C2:N101`,
    });
    const rows = result.data.values || [];
    const out = {};
    rows.forEach((row, i) => {
      const name = (row[0] || '').trim();
      if (!name) return;
      const fips = NAME_TO_FIPS[name];
      if (!fips) {
        console.warn(`Sheet row ${i + 2}: county name "${name}" doesn't match any known NC county — skipping.`);
        return;
      }
      const statusText = (row[1] || '').trim();
      const locked = (row[10] || '').trim().toUpperCase() === 'TRUE';
      const mobilize = (row[11] || '').trim();
      out[fips] = {
        status: SHEET_TEXT_TO_STATUS[statusText] || null,
        locked,
        mobilize,
      };
    });
    res.json(out);
  } catch (err) {
    console.error('Sheets read error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Save / update one county by finding its row and updating just D and M:N
app.post('/api/county', async (req, res) => {
  try {
    const { fips, status, locked, mobilize } = req.body || {};
    if (!fips || !FIPS_TO_NAME[fips]) {
      return res.status(400).json({ error: `invalid fips: ${fips}` });
    }
    if (status && !STATUS_SHEET_TEXT[status]) {
      return res.status(400).json({ error: `invalid status: ${status}` });
    }

    const countyName = FIPS_TO_NAME[fips];

    const colC = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `'${SHEET_TAB}'!C2:C101`,
    });
    const names = (colC.data.values || []).map(r => (r[0] || '').trim());
    const rowIndex = names.indexOf(countyName);
    if (rowIndex === -1) {
      return res.status(404).json({ error: `"${countyName}" not found in the sheet (check for typos in column C)` });
    }
    const row = rowIndex + 2;

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: [
          { range: `'${SHEET_TAB}'!D${row}`, values: [[status ? STATUS_SHEET_TEXT[status] : '']] },
          { range: `'${SHEET_TAB}'!M${row}:N${row}`, values: [[locked ? 'TRUE' : 'FALSE', mobilize || '']] },
        ],
      },
    });

    console.log('Saved county:', fips, countyName, status);
    res.json({ ok: true });
  } catch (err) {
    console.error('Save error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NC County Tracker on port ${PORT}`));
