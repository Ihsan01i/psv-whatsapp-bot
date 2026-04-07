// ============================================================
// PSV SPORTS ACADEMY - WhatsApp Lead Bot + Website Backend
// server.js — Updated for modular bot architecture
// ============================================================

require("dotenv").config();

const express    = require("express");
const bodyParser = require("body-parser");
const cors       = require("cors");

const { handleIncomingMessage }    = require("./bot");
const { sendTextMessage }          = require("./whatsapp");
const { saveLead, testConnection } = require("./sheets");
const logger                       = require("./utils/logger");

const app = express();
app.use(bodyParser.json());
app.use(cors());

const rateLimit = require("express-rate-limit");

app.use("/submit-lead", rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // max 20 requests per IP
  message: "Too many requests. Please try again later."
}));

// ── 1. WEBHOOK VERIFICATION
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

// ── 2. RECEIVE WHATSAPP MESSAGES
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Always 200 immediately
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

// ── 3. WEBSITE LEAD SUBMISSION
const { completeFlow } = require("./flow/handlers");
const { normalizePhone } = require("./utils/phone");

app.post('/submit-lead', async (req, res) => {
  try {
    const { name, phone, sportKey, location } = req.body;

    // ✅ Validate
    if (!name || !phone || !sportKey) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // ✅ Normalize
    const normalizedPhone = normalizePhone(phone);

    // ✅ Session
    const session = {
      name: name.trim(),
      phone: normalizedPhone,
      sportKey,
      location: location?.trim() || ""
    };

    // ✅ Trigger bot flow
    await completeFlow(normalizedPhone, session);

    res.json({ success: true });

  } catch (err) {
    logger.error("Submit lead error:", err.message);
    res.status(400).json({ error: err.message });
  }
});


// ── 4. TEST ADMIN NOTIFICATION
app.get("/test-admin", async (req, res) => {
  const adminPhone = process.env.ADMIN_PHONE;
  if (!adminPhone) return res.send("❌ ADMIN_PHONE is not set!");
  try {
    await sendTextMessage(adminPhone, "🔔 PSV Bot — Test admin notification!\n\nIf you see this, admin alerts are working ✅");
    res.send(`✅ Message sent to: ${adminPhone}`);
  } catch (err) {
    const errMsg = JSON.stringify(err.response?.data || err.message);
    logger.error("Test admin failed:", errMsg);
    res.send(`❌ Failed: ${errMsg}`);
  }
});

// ── 5. HEALTH CHECK
app.get("/health", (req, res) => {
  res.json({
    status:      "running",
    time:        new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    adminPhone:  process.env.ADMIN_PHONE   ? "✅ Set" : "❌ Missing",
    accessToken: process.env.ACCESS_TOKEN  ? "✅ Set" : "❌ Missing",
    sheetId:     process.env.SHEET_ID      ? "✅ Set" : "❌ Missing",
  });
});

// ── 6. START SERVER
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  logger.info(`🚀 PSV Sports Academy Bot running on port ${PORT}`);
  await testConnection();
});
