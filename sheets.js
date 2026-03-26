// ============================================================
// sheets.js — Google Sheets, one tab per sport
// ============================================================
// Setup:
// 1. Create ONE Google Sheet (any name e.g. "PSV Leads")
// 2. Share it with your service account email
// 3. Add to Railway variables:
//    GOOGLE_CREDENTIALS = entire credentials.json content
//    SHEET_ID = ID from your sheet URL
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

async function getOrCreateTab(sheets, spreadsheetId, tabName) {
  const meta     = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets.map(s => s.properties.title);

  if (existing.includes(tabName)) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{ addSheet: { properties: { title: tabName } } }]
    }
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${tabName}!A1:C1`,
    valueInputOption: "RAW",
    requestBody: { values: [["Client Name", "Contact Number", "Address"]] }
  });

  console.log(`📋 Created new tab: ${tabName}`);
}

async function saveLead(lead) {
  const spreadsheetId = process.env.SHEET_ID;
  if (!spreadsheetId) throw new Error("SHEET_ID env variable is missing!");

  const auth    = getAuth();
  const sheets  = google.sheets({ version: "v4", auth });
  const tabName = lead.leadCategory || "General";

  await getOrCreateTab(sheets, spreadsheetId, tabName);

  const row = [
    lead.customerName || "Unknown",
    lead.mobileNumber || "",
    lead.address      || "",
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range:            `${tabName}!A:C`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody:      { values: [row] },
  });

  console.log(`✅ Saved to tab "${tabName}": ${lead.customerName}`);
}

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
