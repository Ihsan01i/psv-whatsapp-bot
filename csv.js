// ============================================================
// csv.js — Save leads to a CSV file
// ============================================================

const fs   = require("fs");
const path = require("path");

function getFilePath(category) {
  const safe = (category || "general")
  .replace(/[^\w\s]/gi, "")
  .toLowerCase()
  .replace(/\s+/g, "_");
  return path.join(__dirname, `${safe}.csv`);
}

// CSV column headers (matches Login2Pro CRM import format)
const HEADERS = [
  "Client Name",
  "Contact Number",
  "Address",
];


// ── Escape a single CSV field ─────────────────────────────────
// Wraps value in quotes if it contains commas, quotes, or newlines
function escapeField(value) {
  const str = String(value ?? "").replace(/"/g, '""'); // Escape existing quotes
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str}"`;
  }
  return str;
}

// ── Save a lead to CSV ────────────────────────────────────────
// lead = { customerName, mobileNumber, leadCategory, address,
//          leadSource, priority, leadStatus }
async function saveLead(lead) {
  const filePath = getFilePath(lead.leadCategory);

if (!fs.existsSync(filePath)) {
  fs.writeFileSync(filePath, HEADERS.join(",") + "\n", "utf8");
}

  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const row = [
  lead.customerName,
  lead.mobileNumber,
  lead.address || "",
]
  .map(escapeField)
  .join(",");

  fs.appendFileSync(filePath, row + "\n", "utf8");
  console.log(`💾 Lead saved: ${lead.customerName} | ${lead.leadCategory}`);
}

module.exports = { saveLead };
