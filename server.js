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
const rateLimit    = require("express-rate-limit");
const jwt          = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const helmet       = require("helmet");
const { OAuth2Client } = require("google-auth-library");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


const { handleIncomingMessage }    = require("./bot");
const { sendTextMessage }          = require("./whatsapp");
const { processLead, fetchLeads }  = require("./services/lead");
const { runBulkSend }              = require("./bulkSender");
const { normalisePhone }           = require("./services/lead");
const logger                       = require("./utils/logger");

const app = express();

app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://accounts.google.com", "https://apis.google.com"],
      connectSrc: ["'self'", "https://accounts.google.com"],
      frameSrc: ["https://accounts.google.com"],
      imgSrc: ["'self'", "data:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
}));

app.use(bodyParser.json());
app.use(cookieParser());
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    process.env.FRONTEND_URL,
    "https://psv-whatsapp-bot-production.up.railway.app",
    "https://psvsports.com"
  ].filter(Boolean),
  credentials: true
}));

const path = require("path");
app.use(express.static(path.join(__dirname, "public")));

// ── Rate Limits ───────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: { success: false, message: "Too many requests, please try again later." }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 20, 
  message: { success: false, error: "Too many login attempts, please try again later." }
});

// ── JWT Auth Middleware ─────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies.admin_token;
  if (!token) {
    return res.status(401).json({ error: "No session token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Contains { email }
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired session" });
  }
}

// ── Google Login Endpoint ───────────────────────────────────────
app.post("/api/admin/google-login", authLimiter, async (req, res) => {
  const { credential } = req.body;
  
  if (!credential) {
    return res.status(400).json({ error: "Google credential missing" });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    const userEmail = payload.email;

    // Parse comma-separated emails from .env (e.g. "admin1@psv.com, admin2@psv.com")
    const allowedEmails = (process.env.ADMIN_EMAIL || "")
      .split(",")
      .map(e => e.trim().toLowerCase());

    const supabase = require("./services/db");

    if (!userEmail || !allowedEmails.includes(userEmail.toLowerCase())) {
      logger.warn(`Google login attempt with unauthorized email: ${userEmail}`);
      supabase.from("admin_logs").insert({
        admin_email: userEmail || "unknown",
        action: "FAILED_LOGIN",
        details: JSON.stringify({ ip: req.ip, userAgent: req.headers["user-agent"], forwarded: req.headers["x-forwarded-for"] })
      }).then();
      return res.status(403).json({ error: "Email not authorized" });
    }

    // Email matches, issue our own session token valid for 6h
    const token = jwt.sign({ email: userEmail }, process.env.JWT_SECRET, { expiresIn: "6h" });
    
    res.cookie("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT,
      sameSite: "strict",
      path: "/",
      maxAge: 6 * 60 * 60 * 1000 // 6 hours
    });

    res.json({ success: true, email: userEmail });

    // DB Audit Log
    supabase.from("admin_logs").insert({
      admin_email: userEmail,
      action: "LOGIN",
      details: "Google Auth successful"
    }).then(({ error }) => { if (error) logger.error("Audit log failed:", error.message) });
  } catch (err) {
    logger.error("Google Auth verification failed:", err.message);
    res.status(500).json({ error: "Authentication failed" });
  }
});

// ── Session Validation & Logout ─────────────────────────────────
app.get("/api/admin/session", requireAuth, (req, res) => {
  res.json({ success: true, email: req.user.email });
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie("admin_token");
  res.json({ success: true });
});

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
app.post("/submit-lead", apiLimiter, async (req, res) => {
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

    res.json({ success: true });
  } catch (err) {
    logger.error("Website lead error:", err.message);
    res.status(500).json({ success: false });
  }
});

// ────────────────────────────────────────────────────────────
// 4. ADMIN: FETCH LEADS  (protected)
//
// GET /api/admin/leads?sportKey=archery&since=2024-01-01&source=whatsapp
// Header: Authorization: Bearer <token>
// ────────────────────────────────────────────────────────────
app.get("/api/admin/leads", requireAuth, async (req, res) => {
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
// ────────────────────────────────────────────────────────────
app.post("/api/admin/bulk-send", requireAuth, async (req, res) => {
  // Respond immediately — bulk send may take minutes
  res.json({ success: true, message: "Bulk send started. Check server logs." });

  const { sportKey, templateKey, dryRun, limit } = req.body;
  const userEmail = req.user?.email || "Unknown admin";
  
  const supabase = require("./services/db");
  supabase.from("admin_logs").insert({
    admin_email: userEmail,
    action: "BULK_SEND_TRIGGER",
    details: JSON.stringify({ sportKey, templateKey, dryRun, limit, ip: req.ip })
  }).then();

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
    supabaseUrl:    process.env.SUPABASE_URL      ? "✅ Set" : "❌ Missing",
    supabaseKey:    process.env.SUPABASE_SERVICE_KEY ? "✅ Set" : "❌ Missing",
    adminApiKey:    process.env.ADMIN_API_KEY     ? "✅ Set" : "⚠️ No admin API key",
  });
});

// ────────────────────────────────────────────────────────────
// 7. Export Leads
// ────────────────────────────────────────────────────────────

app.get("/api/admin/export-leads", requireAuth, async (req, res) => {
  try {
    const userEmail = req.user?.email || "Unknown admin";
    const sport = req.query.sport || 'all';
    logger.info(`[ADMIN ACTION] ${userEmail} exported leads for sport: ${sport}`);
    
    const supabase = require("./services/db");
    
    // DB Audit Log
    supabase.from("admin_logs").insert({
      admin_email: userEmail,
      action: "EXPORT_LEADS",
      details: `Exported sport: ${sport}`
    }).then(({ error }) => { if (error) logger.error("Audit log failed:", error.message) });

    let query = supabase
      .from("leads")
      .select("*")
      .eq("crm_uploaded", false);

    if (sport && sport !== "all") {
      query = query.eq("sport_key", sport);
    }

    const { data, error } = await query;
    if (error) throw error;

    function escapeCSV(str) {
      if (!str) return "";
      const s = String(str);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }

    const rows = ["Name,Phone,Location"];
    data.forEach(l => {
      rows.push(`${escapeCSV(l.name)},${escapeCSV(l.phone)},${escapeCSV(l.location)}`);
    });

    const csv = rows.join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=leads_${sport}.csv`
    );
    res.setHeader("X-Lead-Count", data.length);

    res.send(csv);

    const ids = data.map(l => l.id);

    if (ids.length > 0) {
      await supabase
        .from("leads")
        .update({
          crm_uploaded: true,
          crm_uploaded_at: new Date().toISOString()
        })
        .in("id", ids);
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Export failed" });
  }
});

// ────────────────────────────────────────────────────────────
// 8. Export Count

app.get("/api/admin/export-count", requireAuth, async (req, res) => {
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
// 9. START SERVER
// ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  logger.info(`🚀 PSV Sports Academy Bot running on port ${PORT}`);
});