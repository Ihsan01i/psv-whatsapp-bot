// ============================================================
// server.js — PSV Sports Academy: Updated for Phase 2 (Supabase)
//
// Changes from Phase 1:
//   - /submit-lead now saves to Supabase (not just Sheets/CSV)
//   - Added /api/leads  → fetch/filter leads (admin use)
//   - Added /api/bulk-send → trigger bulk WhatsApp send
//
// Backwards compatible: Google Sheets integration can remain
// in parallel during transition — just set SHEET_ID in .env.
// ============================================================

require("dotenv").config();

const express    = require("express");
const bodyParser = require("body-parser");
const cors       = require("cors");

const { handleIncomingMessage }    = require("./bot");
const { sendTextMessage }          = require("./whatsapp");
const { saveLead, testConnection } = require("./sheets");   // keep during transition
const { processLead, fetchLeads }  = require("./services/lead");
const { runBulkSend }              = require("./bulkSender");
const { normalisePhone }           = require("./services/lead");
const logger                       = require("./utils/logger");

const app = express();
app.use(bodyParser.json());
app.use(cors());

const path = require("path");
app.use(express.static(path.join(__dirname)));

// ── Optional: simple API key guard for admin routes ───────────
function requireAdminKey(req, res, next) {
  const key = req.headers["x-admin-key"] || req.query.adminKey;
  if (key && key === process.env.ADMIN_API_KEY) return next();
  return res.status(401).json({ error: "Unauthorised" });
}

// ────────────────────────────────────────────────────────────
// 1. WEBHOOK VERIFICATION
// ────────────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "psv_sports_token";
  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    logger.info("Webhook verified by Meta");
    return res.status(200).send(challenge);
  }
  logger.error("Webhook verification failed. Check VERIFY_TOKEN.");
  return res.sendStatus(403);
});

// ────────────────────────────────────────────────────────────
// 2. RECEIVE WHATSAPP MESSAGES
// ────────────────────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (
      body.object === "whatsapp_business_account" &&
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) {
      const change  = body.entry[0].changes[0].value;
      const message = change.messages[0];
      const contact = change.contacts?.[0];
      await handleIncomingMessage(message, contact);
    }
  } catch (err) {
    logger.error("Error handling WhatsApp message:", err.message);
  }
});

// ────────────────────────────────────────────────────────────
// 3. WEBSITE LEAD SUBMISSION  ← Updated for Supabase
// ────────────────────────────────────────────────────────────
app.post("/submit-lead", async (req, res) => {
  try {
    const { name, phone, sport, age, time, location } = req.body;

    if (!name || !phone || !sport) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const normalisedPhone = normalisePhone(phone);

    // Build a session-like object compatible with processLead()
    const session = {
      name,
      phone:    normalisedPhone,
      sportKey: sport,
      location: location || "",
      waName:   "",
      source:   "website",
    };

    // tabName for website leads = sport value as received
    // (you can map this to your sports.js tabName if needed)
    const tabName = sport;

    // Save to Supabase + notify admin — both fault-tolerant
    await processLead(session, tabName);

    // Keep saving to Sheets during the transition period
    // Remove this block once you've fully moved to Supabase:
    try {
      await saveLead({
        customerName: name,
        mobileNumber: normalisedPhone,
        leadCategory: sport,
        address:      location || "",
      });
    } catch (sheetErr) {
      logger.warn("[Server] Sheets save failed (non-fatal):", sheetErr.message);
    }

    res.json({ success: true });
  } catch (err) {
    logger.error("Website lead error:", err.message);
    res.status(500).json({ success: false });
  }
});

// ────────────────────────────────────────────────────────────
// 4. ADMIN: FETCH LEADS  (protected)
//
// GET /api/leads?sportKey=archery&since=2024-01-01&source=whatsapp
// Header: x-admin-key: <ADMIN_API_KEY>
// ────────────────────────────────────────────────────────────
app.get("/api/leads", requireAdminKey, async (req, res) => {
  try {
    const { sportKey, since, source, limit } = req.query;
    const leads = await fetchLeads({
      sportKey: sportKey || undefined,
      since:    since    || undefined,
      source:   source   || undefined,
      limit:    limit ? parseInt(limit, 10) : 500,
    });
    res.json({ success: true, count: leads.length, leads });
  } catch (err) {
    logger.error("[API] /api/leads error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// 5. ADMIN: TRIGGER BULK SEND  (protected)
//
// POST /api/bulk-send
// Body: { sportKey, templateKey, dryRun, limit }
// Header: x-admin-key: <ADMIN_API_KEY>
//
// ⚠️  Only call this for users who opted in via WhatsApp.
// ────────────────────────────────────────────────────────────
app.post("/api/bulk-send", requireAdminKey, async (req, res) => {
  // Respond immediately — bulk send may take minutes
  res.json({ success: true, message: "Bulk send started. Check server logs." });

  const { sportKey, templateKey, dryRun, limit } = req.body;

  try {
    const results = await runBulkSend({
      sportKey:    sportKey    || null,
      templateKey: templateKey || "general_followup",
      dryRun:      dryRun      ?? false,
      limit:       limit       || 100,
    });
    logger.info("[API] Bulk send completed:", results);
  } catch (err) {
    logger.error("[API] /api/bulk-send error:", err.message);
  }
});

// ────────────────────────────────────────────────────────────
// 6. HEALTH CHECK
// ────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status:         "running",
    time:           new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    adminPhone:     process.env.ADMIN_PHONE       ? "✅ Set" : "❌ Missing",
    accessToken:    process.env.ACCESS_TOKEN      ? "✅ Set" : "❌ Missing",
    sheetId:        process.env.SHEET_ID          ? "✅ Set" : "⚠️ Optional",
    supabaseUrl:    process.env.SUPABASE_URL      ? "✅ Set" : "❌ Missing",
    supabaseKey:    process.env.SUPABASE_SERVICE_KEY ? "✅ Set" : "❌ Missing",
    adminApiKey:    process.env.ADMIN_API_KEY     ? "✅ Set" : "⚠️ No admin API key",
  });
});

// ────────────────────────────────────────────────────────────
// 7. START SERVER
// ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  logger.info(`🚀 PSV Sports Academy Bot running on port ${PORT}`);
  await testConnection().catch(() => logger.warn("Sheets offline — Supabase is primary"));
});
// ────────────────────────────────────────────────────────────
// 8. Export Count
// ────────────────────────────────────────────────────────────

app.get("/api/export-count", async (req, res) => {
  try {
    const supabase = require("./services/db");

    const { data, error } = await supabase
      .from("leads")
      .select("sport_key")
      .eq("crm_uploaded", false);

    if (error) throw error;

    const breakdown = {};
    data.forEach(l => {
      breakdown[l.sport_key] = (breakdown[l.sport_key] || 0) + 1;
    });

    res.json({
      total: data.length,
      breakdown
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// 8. Export Count
// ────────────────────────────────────────────────────────────

app.get("/api/export-count", async (req, res) => {
  try {
    const supabase = require("./services/db");

    const { data, error } = await supabase
      .from("leads")
      .select("sport_key")
      .eq("crm_uploaded", false);

    if (error) throw error;

    const breakdown = {};
    data.forEach(l => {
      breakdown[l.sport_key] = (breakdown[l.sport_key] || 0) + 1;
    });

    res.json({
      total: data.length,
      breakdown
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});