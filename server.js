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

// Read-only: this app is a viewer, not an editor, so the service account
// only ever needs read access to the sheet.
const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

const sheets = google.sheets({ version: 'v4', auth });

// Column D's dropdown text -> the app's internal status key (trimmed since
// the sheet's "Staff Knocks " option has a trailing space).
const STATUS_SHEET_TEXT = {
  volunteer_led: 'Volunteer-Led Launch',
  partner:       'Bought-in Partner Launcher',
  county_party:  'County Party Launch',
  staff_led:     'Staff-Led Launch',
  staff_knocks:  'Staff Knocks ',
};
const SHEET_TEXT_TO_STATUS = Object.fromEntries(
  Object.entries(STATUS_SHEET_TEXT).map(([status, text]) => [text.trim(), status])
);

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, sheetId: SHEET_ID, tab: SHEET_TAB });
});

// Return all county assignments, read live from the sheet.
// Uses spreadsheets.get (not values.get) so we can see each cell's real
// hyperlink target, not just its displayed text — people link custom text
// like "Here" over the actual Mobilize URL, which values.get can't see.
app.get('/api/counties', async (req, res) => {
  try {
    const result = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      ranges: [`'${SHEET_TAB}'!C2:N101`],
      fields: 'sheets(data(rowData(values(formattedValue,hyperlink))))',
    });
    const rowData = result.data.sheets?.[0]?.data?.[0]?.rowData || [];
    const out = {};
    rowData.forEach((rowObj, i) => {
      const cells = rowObj.values || [];
      const cellText = idx => (cells[idx]?.formattedValue || '').trim();

      const name = cellText(0);
      if (!name) return;
      const fips = NAME_TO_FIPS[name];
      if (!fips) {
        console.warn(`Sheet row ${i + 2}: county name "${name}" doesn't match any known NC county — skipping.`);
        return;
      }
      const statusText = cellText(1);
      const locked = cellText(10).toUpperCase() === 'TRUE';
      const mobilizeCell = cells[11];
      const mobilize = (mobilizeCell?.hyperlink || mobilizeCell?.formattedValue || '').trim();
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NC County Tracker on port ${PORT}`));
