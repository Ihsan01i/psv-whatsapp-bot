// ============================================================
// PSV SPORTS ACADEMY - WhatsApp Lead Bot + Website Backend
// server.js — FINAL VERSION
// ============================================================

require("dotenv").config();

const express    = require("express");
const bodyParser = require("body-parser");

const { handleIncomingMessage } = require("./bot");
const { sendTextMessage }       = require("./whatsapp");
const { saveLead, testConnection } = require("./sheets");

const app = express();
app.use(bodyParser.json());


// ── 1. WEBHOOK VERIFICATION ──────────────────────────────────
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "psv_sports_token";

  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified by Meta!");
    return res.status(200).send(challenge);
  }

  console.error("❌ Webhook verification failed. Check VERIFY_TOKEN.");
  return res.sendStatus(403);
});


// ── 2. RECEIVE WHATSAPP MESSAGES ─────────────────────────────
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
    console.error("❌ Error handling WhatsApp message:", err);
    res.sendStatus(200);
  }
});


// ── 3. WEBSITE LEAD SUBMISSION ───────────────────────────────
app.post("/submit-lead", async (req, res) => {
  try {
    const { name, phone, sport, age, time, location } = req.body;

    // Basic validation
    if (!name || !phone || !sport) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    // Save to Google Sheets
    await saveLead({
      customerName: name,
      mobileNumber: phone,
      leadCategory: sport,
      address: location || ""
    });

    // Send admin WhatsApp notification
    const adminMsg =
      `🌐 *New Website Lead!*\n\n` +
      `👤 Name: ${name}\n` +
      `📞 Phone: ${phone}\n` +
      `🏅 Sport: ${sport}\n` +
      `🕐 Age: ${age || "-"} | Time: ${time || "-"}\n` +
      `📍 Location: ${location || "Not provided"}`;

    await sendTextMessage(process.env.ADMIN_PHONE, adminMsg);

    console.log("✅ Website lead saved + admin notified");

    res.json({ success: true });

  } catch (err) {
    console.error("❌ Website lead error:", err);
    res.status(500).json({ success: false });
  }
});


// ── 4. TEST ADMIN NOTIFICATION ───────────────────────────────
// Visit: /test-admin
app.get("/test-admin", async (req, res) => {
  const adminPhone = process.env.ADMIN_PHONE;

  if (!adminPhone) {
    return res.send("❌ ADMIN_PHONE is not set in Railway variables!");
  }

  try {
    await sendTextMessage(
      adminPhone,
      "🔔 PSV Bot — Test admin notification!\n\nIf you see this, admin alerts are working ✅"
    );

    res.send(`✅ Message sent to: ${adminPhone}`);
  } catch (err) {
    const errMsg = JSON.stringify(err.response?.data || err.message);
    console.error("❌ Test admin failed:", errMsg);
    res.send(`❌ Failed: ${errMsg}`);
  }
});


// ── 5. HEALTH CHECK ──────────────────────────────────────────
// Visit: /health
app.get("/health", (req, res) => {
  res.json({
    status: "running",
    time: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
    adminPhone: process.env.ADMIN_PHONE ? "✅ Set" : "❌ Missing",
    accessToken: process.env.ACCESS_TOKEN ? "✅ Set" : "❌ Missing",
    sheetId: process.env.SHEET_ID ? "✅ Set" : "❌ Missing",
  });
});


// ── 6. START SERVER ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 PSV Bot server running on port ${PORT}`);
  await testConnection(); // Check Google Sheets on startup
});