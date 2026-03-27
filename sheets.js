// ============================================================
// sheets.js — Google Sheets, one tab per sport
// Columns: Client Name | Contact Number | Address | Date | Uploaded
//
// HOW TO USE:
// - Bot auto-fills: Client Name, Contact Number, Address, Date
// - You fill manually: type "YES" in Uploaded column after CRM upload
// - To export only new leads:
//     1. Filter Uploaded column → show blanks only
//     2. File → Download → CSV
//     3. Upload to Login2Pro
//     4. Type YES in Uploaded column for those rows
// ============================================================

const { google } = require("googleapis");

function getAuth() {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) throw new Error("GOOGLE_CREDENTIALS env variable is missing!");
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

// ── Get or create a tab by sport name ────────────────────────
async function getOrCreateTab(sheets, spreadsheetId, tabName) {
  const meta     = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.map(s => s.properties.title);

  if (existing.includes(tabName)) return;

  // Create the tab
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabName } } }]
    }
  });

  // Add headers to new tab
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range:            `${tabName}!A1:E1`,
    valueInputOption: "RAW",
    requestBody: {
      values: [["Client Name", "Contact Number", "Address", "Date", "Uploaded"]]
    }
  });

  console.log(`📋 Created new tab: "${tabName}"`);
}

// ── Save one lead row ─────────────────────────────────────────
async function saveLead(lead) {
  const spreadsheetId = process.env.SHEET_ID;
  if (!spreadsheetId) throw new Error("SHEET_ID env variable is missing!");

  const auth   = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const tabName = lead.leadCategory || "General";

  // Create tab if it doesn't exist yet
  await getOrCreateTab(sheets, spreadsheetId, tabName);

  // Build the row — 5 columns
  const date = new Date().toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day:      "2-digit",
    month:    "2-digit",
    year:     "numeric",
  });

  const row = [
    lead.customerName || "Unknown", // A - Client Name
    lead.mobileNumber || "",        // B - Contact Number
    lead.address      || "",        // C - Address
    date,                           // D - Date (auto)
    "",                             // E - Uploaded (you type YES manually)
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range:            `${tabName}!A:E`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody:      { values: [row] },
  });

  console.log(`✅ Lead saved → "${tabName}" | ${lead.customerName} | ${date}`);
}

// ── Test connection on server start ──────────────────────────
async function testConnection() {
  try {
    const spreadsheetId = process.env.SHEET_ID;
    if (!spreadsheetId) {
      console.warn("⚠️  SHEET_ID not set — Google Sheets disabled");
      return false;
    }
    const auth   = getAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const meta   = await sheets.spreadsheets.get({ spreadsheetId });
    console.log(`✅ Google Sheets connected: "${meta.data.properties.title}"`);
    return true;
  } catch (err) {
    console.error("❌ Google Sheets connection failed:", err.message);
    return false;
  }
}

module.exports = { saveLead, testConnection };