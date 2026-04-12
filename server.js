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

const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const { OAuth2Client } = require("google-auth-library");
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


const { handleIncomingMessage } = require("./bot");
const { sendTextMessage } = require("./whatsapp");
const { processLead, fetchLeads } = require("./services/lead");
const { startWorker } = require("./services/worker");
const { normalisePhone } = require("./services/lead");
const supabase = require("./services/db");
const logger = require("./utils/logger");

if (!process.env.VERIFY_TOKEN) {
  throw new Error("FATAL: VERIFY_TOKEN environment variable is missing.");
}

const app = express();

app.set("trust proxy", 1);

app.use(helmet({
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" }, // Required for Google Sign-In popup flow
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com", "https://apis.google.com", "https://www.gstatic.com"],
      scriptSrcAttr: ["'unsafe-inline'"], // Required: Helmet blocks inline onclick= by default via script-src-attr: none
      connectSrc: ["'self'", "https://accounts.google.com", "https://oauth2.googleapis.com"],
      frameSrc: ["https://accounts.google.com", "https://www.google.com"],
      imgSrc: ["'self'", "data:", "https://lh3.googleusercontent.com", "https://www.gstatic.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://accounts.google.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
    },
  },
}));

app.use(bodyParser.json({
  verify: (req, res, buf) => {
    if (req.originalUrl === "/webhook") {
      req.rawBody = buf; // Stash the raw buffer for HMAC
    }
  }
}));

const crypto = require("crypto");

function verifyWebhookSignature(req, res, next) {
  const signature = req.headers["x-hub-signature-256"];
  if (!signature) {
    return res.status(403).json({ error: "Missing signature" });
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret) {
    // Fail closed — do not allow requests if secret is not configured
    return res.status(500).json({ error: "Server misconfiguration" });
  }

  // IMPORTANT: use the raw body buffer, not the parsed JSON
  const expectedSig = "sha256=" + crypto
    .createHmac("sha256", appSecret)
    .update(req.rawBody)
    .digest("hex");

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return res.status(403).json({ error: "Invalid signature" });
  }
  next();
}
app.use(cookieParser());
app.use(cors({
  origin: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    process.env.FRONTEND_URL,
    "https://psv-whatsapp-bot-production.up.railway.app",
    "https://prosportsventures.in",
    "https://www.prosportsventures.in",
    "https://api.prosportsventures.in",
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

// ── Supabase audit log helper ──────────────────────────────────
// Supabase v2 query builders are thenable but NOT full Promises.
// Chaining .catch() directly throws TypeError. Use this wrapper instead.
async function safeLog(queryPromise) {
  try {
    const { error } = await queryPromise;
    if (error) logger.error("Audit log failed:", error.message);
  } catch (err) {
    logger.error("Audit log failed:", err.message);
  }
}

function formatExportFilename(sport) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const safeSport = String(sport || "all").replace(/[^\w-]/g, "_");
  return `psv_leads_${safeSport}_${date}_${time}.csv`;
}

function parseAuditDetails(details) {
  if (!details) return {};
  if (typeof details === "object") return details;
  if (typeof details !== "string") return {};

  try {
    return JSON.parse(details);
  } catch (_) {
    return { note: details };
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
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    if (allowedEmails.length === 0) {
      throw new Error("FATAL: ADMIN_EMAIL is not configured with any valid addresses.");
    }

    if (!userEmail || !allowedEmails.includes(userEmail.toLowerCase())) {
      logger.warn(`Google login attempt with unauthorized email: ${userEmail}`);
      await safeLog(supabase.from("admin_logs").insert({
        admin_email: userEmail || "unknown",
        action: "FAILED_LOGIN",
        details: JSON.stringify({ ip: req.ip, userAgent: req.headers["user-agent"], forwarded: req.headers["x-forwarded-for"] })
      }));
      return res.status(403).json({ error: "Email not authorized" });
    }

    // Email matches, issue our own session token valid for 6h
    const SESSION_DURATION_MS = 6 * 60 * 60 * 1000;
    const token = jwt.sign({ email: userEmail }, process.env.JWT_SECRET, {
      expiresIn: Math.floor(SESSION_DURATION_MS / 1000)
    });

    res.cookie("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT,
      sameSite: "strict",
      path: "/",
      maxAge: SESSION_DURATION_MS // 6 hours
    });

    // DB Audit Log — must complete before res.json so errors don't double-send
    await safeLog(supabase.from("admin_logs").insert({
      admin_email: userEmail,
      action: "LOGIN",
      details: "Google Auth successful"
    }));

    res.json({ success: true, email: userEmail });
  } catch (err) {
    logger.error("Google Auth verification failed:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Authentication failed" });
  }
});

// ── Session Validation & Logout ─────────────────────────────────
app.get("/api/admin/session", requireAuth, (req, res) => {
  res.json({ success: true, email: req.user.email });
});

app.post("/api/admin/logout", (req, res) => {
  res.clearCookie("admin_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || !!process.env.RAILWAY_ENVIRONMENT,
    sameSite: "strict",
    path: "/"
  });
  res.json({ success: true });
});

// ────────────────────────────────────────────────────────────
// 1. WEBHOOK VERIFICATION
// ────────────────────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
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
app.post("/webhook", verifyWebhookSignature, async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (
      body.object === "whatsapp_business_account" &&
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) {
      const change = body.entry[0].changes[0].value;
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
      phone: normalisedPhone,
      sportKey: sport,
      location: location || "",
      waName: "",
      source: "website",
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

    const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.Z+-]+)?$/;
    const safeSince = since && ISO_DATE_RE.test(since) ? since : undefined;

    const MAX_QUERY_LIMIT = 1000;
    const parsedLimit = limit ? parseInt(limit, 10) : 500;
    const safeLimit = isNaN(parsedLimit) ? 500 : Math.min(parsedLimit, MAX_QUERY_LIMIT);

    const leads = await fetchLeads({
      sportKey: sportKey || undefined,
      since: safeSince,
      source: source || undefined,
      limit: safeLimit > 0 ? safeLimit : 500,
    });
    res.json({ success: true, count: leads.length, leads });
  } catch (err) {
    logger.error("[API] /api/leads error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// 5. ADMIN: TRIGGER BULK SEND (Queue Job)
// ────────────────────────────────────────────────────────────
app.post("/api/admin/bulk-send", requireAuth, async (req, res) => {
  try {
    const { sportKey, templateKey, dryRun, limit } = req.body;

    const { TEMPLATES } = require("./bulkSender");
    const VALID_TEMPLATE_KEYS = Object.keys(TEMPLATES);

    const parsedLimit = parseInt(limit, 10);
    const safeLimit = (!isNaN(parsedLimit) && parsedLimit > 0)
      ? Math.min(parsedLimit, 500)
      : 100;

    const safeTemplateKey = templateKey || "general_followup";
    if (!VALID_TEMPLATE_KEYS.includes(safeTemplateKey)) {
      return res.status(400).json({ error: `Invalid template. Must be one of: ${VALID_TEMPLATE_KEYS.join(", ")}` });
    }

    const userEmail = req.user?.email || "Unknown admin";
    // Audit Logging
    await safeLog(supabase.from("admin_logs").insert({
      admin_email: userEmail,
      action: "BULK_SEND_TRIGGER",
      details: JSON.stringify({ sportKey, templateKey: safeTemplateKey, dryRun, limit: safeLimit, ip: req.ip })
    }));

    // Create Async Job
    const payload = {
      sportKey: sportKey || null,
      templateKey: safeTemplateKey,
      dryRun: dryRun ?? false,
      limit: safeLimit,
    };

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        type: "bulk_send",
        payload,
        status: "pending"
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, message: "Job created successfully", job });
  } catch (err) {
    logger.error("[API] /api/admin/bulk-send error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// 5B. ADMIN: GET JOBS STATUS (protected)
// ────────────────────────────────────────────────────────────
app.get("/api/admin/jobs", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ success: true, jobs: data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// 6. HEALTH CHECK
// ────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
  });
});

// ────────────────────────────────────────────────────────────
// 7. Export Leads
// ────────────────────────────────────────────────────────────

let exportLockActive = false;

app.get("/api/admin/export-leads", requireAuth, async (req, res) => {
  if (exportLockActive) {
    return res.status(409).json({
      error: "An export is already in progress. Please wait for it to complete."
    });
  }

  exportLockActive = true;
  const exportedIds = [];

  try {
    const userEmail = req.user?.email || "Unknown admin";
    const sport = req.query.sport || 'all';
    logger.info(`[ADMIN ACTION] ${userEmail} started export for sport: ${sport}`);

    // Stream Setup
    const baseQuery = () => {
      let q = supabase
        .from("leads")
        .select("id, name, phone, location, sport_key", { count: "exact" })
        .eq("crm_uploaded", false)
        .order("id", { ascending: true }); // Ensure stable sorting for pagination

      if (sport && sport !== "all") {
        q = q.eq("sport_key", sport);
      }
      return q;
    };

    // Get total count
    const { count, error: countErr } = await baseQuery().limit(1);
    if (countErr) throw countErr;

    res.setHeader("Content-Type", "text/csv");
    const filename = formatExportFilename(sport);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("X-Lead-Count", count || 0);

    // Write header
    res.write("Name,Phone,Location\n");

    if (count === 0) {
      exportLockActive = false;
      return res.end();
    }

    function escapeCSV(str) {
      if (!str) return "";
      const s = String(str);
      if (s.includes(",") || s.includes('"') || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    }

    // Stream by pages
    const PAGE_SIZE = 1000;
    const breakdown = {};

    for (let offset = 0; offset < count; offset += PAGE_SIZE) {
      const { data, error } = await baseQuery().range(offset, offset + PAGE_SIZE - 1);

      if (error) {
        logger.error(`[Export] Error paginating leads at offset ${offset}:`, error.message);
        break;
      }

      for (const l of data) {
        res.write(`${escapeCSV(l.name)},${escapeCSV(l.phone)},${escapeCSV(l.location)}\n`);
        exportedIds.push(l.id);
        if (l.sport_key) {
          breakdown[l.sport_key] = (breakdown[l.sport_key] || 0) + 1;
        }
      }
    }

    // Mark as uploaded BEFORE releasing the lock, while we still own it
    if (exportedIds.length > 0) {
      const CHUNK_SIZE = 500;
      for (let i = 0; i < exportedIds.length; i += CHUNK_SIZE) {
        const chunk = exportedIds.slice(i, i + CHUNK_SIZE);
        await safeLog(supabase
          .from("leads")
          .update({
            crm_uploaded: true,
            crm_uploaded_at: new Date().toISOString()
          })
          .in("id", chunk));
      }
    }

    // End stream
    res.end();

    await safeLog(supabase.from("admin_logs").insert({
      admin_email: userEmail,
      action: "EXPORT_LEADS",
      details: JSON.stringify({
        sport,
        leadCount: exportedIds.length,
        breakdown,
        filename,
        status: exportedIds.length > 0 ? "exported" : "empty"
      })
    }));

  } catch (err) {
    logger.error("Export failed", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Export failed" });
    }
  } finally {
    exportLockActive = false; // Always released, even on crash
  }
});

// ────────────────────────────────────────────────────────────
// 8. Export Count

app.get("/api/admin/export-count", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("pending_leads_stats")
      .select("*");

    if (error) throw error;

    const breakdown = (data || []).reduce((acc, row) => ({ ...acc, [row.sport_key]: row.count }), {});
    const total = (data || []).reduce((sum, row) => sum + row.count, 0);

    res.json({ total, breakdown });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ────────────────────────────────────────────────────────────
// 9. START SERVER & WORKER
// ────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  logger.info(`🚀 PSV Sports Academy Bot running on port ${PORT}`);

  // Start the background job queue if enabled
  const WORKER_ENABLED = process.env.WORKER_ENABLED !== "false";
  if (WORKER_ENABLED) {
    startWorker();
  } else {
    logger.info(`[Worker] Stopped via WORKER_ENABLED=false`);
  }
});

app.get("/api/admin/recent-exports", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("admin_logs")
      .select("id, admin_email, created_at, details")
      .eq("action", "EXPORT_LEADS")
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw error;

    const exports = (data || []).map((row) => {
      const details = parseAuditDetails(row.details);
      return {
        id: row.id,
        adminEmail: row.admin_email,
        createdAt: row.created_at,
        sport: details.sport || "all",
        count: Number(details.leadCount || 0),
        breakdown: details.breakdown || {},
        filename: details.filename || "",
        status: details.status || "exported",
      };
    });

    res.json({ success: true, exports });
  } catch (err) {
    logger.error("[API] /api/admin/recent-exports error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
