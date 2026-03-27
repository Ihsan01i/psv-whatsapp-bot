// ============================================================
// PSV SPORTS ACADEMY - WhatsApp Lead Bot
// server.js — Main entry point
// ============================================================

require("dotenv").config();

const express    = require("express");
const bodyParser = require("body-parser");
const { handleIncomingMessage } = require("./bot");
const { sendTextMessage }       = require("./whatsapp");
const { testConnection }        = require("./sheets");

const app = express();
app.use(bodyParser.json());

// ── 1. WEBHOOK VERIFICATION ──────────────────────────────────
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "psv_sports_token";
  const mode         = req.query["hub.mode"];
  const token        = req.query["hub.verify_token"];
  const challenge    = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified by Meta!");
    return res.status(200).send(challenge);
  }
  console.error("❌ Webhook verification failed. Check VERIFY_TOKEN.");
  res.sendStatus(403);
});

// ── 2. RECEIVE MESSAGES ──────────────────────────────────────
app.post("/webhook", async (req, res) => {
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

    res.sendStatus(200);
  } catch (err) {
    console.error("Error handling message:", err);
    res.sendStatus(200);
  }
});

// ── 3. TEST ADMIN NOTIFICATION ───────────────────────────────
// Visit: https://YOUR-RAILWAY-URL/test-admin
// Remove this route once admin notification is confirmed working
app.get("/test-admin", async (req, res) => {
  const adminPhone = process.env.ADMIN_PHONE;

  if (!adminPhone) {
    return res.send("❌ ADMIN_PHONE is not set in Railway variables!");
  }

  try {
    await sendTextMessage(adminPhone, "🔔 PSV Bot — Test admin notification!\n\nIf you see this, admin notifications are working ✅");
    res.send(`✅ Message sent to: ${adminPhone} — check that WhatsApp now!`);
  } catch (err) {
    const errMsg = JSON.stringify(err.response?.data || err.message);
    console.error("❌ Test admin failed:", errMsg);
    res.send(`❌ Failed to send. Error: ${errMsg}`);
  }
});

// ── 4. HEALTH CHECK ──────────────────────────────────────────
// Visit: https://YOUR-RAILWAY-URL/health
app.get("/health", (req, res) => {
  res.json({
    status:      "running",
    time:        new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    adminPhone:  process.env.ADMIN_PHONE ? "✅ Set" : "❌ Missing",
    accessToken: process.env.ACCESS_TOKEN ? "✅ Set" : "❌ Missing",
    sheetId:     process.env.SHEET_ID    ? "✅ Set" : "❌ Missing",
  });
});

// ── 5. START SERVER ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`🚀 PSV Bot server running on port ${PORT}`);
  await testConnection(); // Test Google Sheets on startup
});