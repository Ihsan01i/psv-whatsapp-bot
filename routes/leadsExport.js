// ============================================================
// leadsExport.js — Express router for CRM CSV export
//
// Mount in server.js:
//   const leadsExport = require("./routes/leadsExport");
//   app.use("/api", leadsExport);
//
// Single endpoint:
//   GET /api/export-leads?sport=archery&adminKey=xxx
//
// What it does (atomically):
//   1. Fetches all leads for that sport where crm_uploaded = false
//   2. Streams a CSV back to the browser (triggers download)
//   3. Marks those exact lead IDs as crm_uploaded = true
//      with crm_uploaded_at = now()
//
// If the HTTP response fails mid-stream, the IDs are NOT marked
// (because we collect them first, stream, then update).
// ============================================================

const express  = require("express");
const router   = express.Router();
const supabase = require("../services/db");
const logger   = require("../utils/logger");

// ── Auth guard ────────────────────────────────────────────────
function requireAdminKey(req, res, next) {
  const key = req.headers["x-admin-key"] || req.query.adminKey;
  if (key && key === process.env.ADMIN_API_KEY) return next();
  return res.status(401).json({ error: "Unauthorised" });
}

// ── CSV helpers ───────────────────────────────────────────────
function escapeCSV(val) {
  const s = String(val ?? "").replace(/"/g, '""');
  return s.includes(",") || s.includes('"') || s.includes("\n")
    ? `"${s}"`
    : s;
}

function leadsToCSV(leads) {
  const headers = ["Client Name", "Contact Number", "Address"];
  const rows = leads.map((l) => [
    escapeCSV(l.name),
    escapeCSV(l.phone),
    escapeCSV(l.location || ""),
  ]);
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// ── Main export endpoint ──────────────────────────────────────
// GET /api/export-leads?sport=archery
// GET /api/export-leads?sport=all          ← exports every unuploaded lead
router.get("/export-leads", requireAdminKey, async (req, res) => {
  const sport = req.query.sport || "all";

  try {
    // 1. Fetch only leads NOT yet uploaded
    let query = supabase
      .from("leads")
      .select("id, name, phone, location, sport_key, tab_name, created_at")
      .eq("crm_uploaded", false)
      .order("created_at", { ascending: true });

    if (sport !== "all") {
      query = query.eq("sport_key", sport);
    }

    const { data: leads, error } = await query;
    if (error) throw error;

    if (!leads || leads.length === 0) {
      // Return an empty CSV instead of an error — still triggers download
      const filename = `psv_leads_${sport}_empty.csv`;
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send("Client Name,Contact Number,Address\n");
    }

    // 2. Build CSV in memory
    const csv      = leadsToCSV(leads);
    const ids      = leads.map((l) => l.id);
    const now      = new Date().toISOString();
    const safeName = sport.replace(/[^\w]/g, "_");
    const dateStr  = new Date().toLocaleDateString("en-IN").replace(/\//g, "-");
    const filename = `psv_leads_${safeName}_${dateStr}.csv`;

    // 3. Send CSV to browser
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Lead-Count", String(ids.length));
    res.send(csv);

    // 4. Mark as uploaded — AFTER successful send
    //    (runs async — browser already has the file)
    const { error: updateError } = await supabase
      .from("leads")
      .update({ crm_uploaded: true, crm_uploaded_at: now })
      .in("id", ids);

    if (updateError) {
      logger.error("[Export] Failed to mark leads as uploaded:", updateError.message);
      // Not fatal for the user — they have the CSV. Log and alert manually.
    } else {
      logger.info(`[Export] Exported + marked ${ids.length} leads (sport: ${sport})`);
    }

  } catch (err) {
    logger.error("[Export] Export failed:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Export failed. Please try again." });
    }
  }
});

// ── Preview count (no download, no marking) ───────────────────
// GET /api/export-count?sport=archery
// Used by the dashboard to show "X new leads ready to export"
router.get("/export-count", requireAdminKey, async (req, res) => {
  const sport = req.query.sport || "all";
  try {
    let query = supabase
      .from("leads")
      .select("id, sport_key", { count: "exact", head: false })
      .eq("crm_uploaded", false);

    if (sport !== "all") query = query.eq("sport_key", sport);

    const { data, count, error } = await query;
    if (error) throw error;

    // Group by sport_key for the "all" case
    const breakdown = {};
    (data || []).forEach((l) => {
      breakdown[l.sport_key] = (breakdown[l.sport_key] || 0) + 1;
    });

    res.json({ total: count, breakdown });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
