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
app.post("/submit-lead", async (req, res) => {
  try {
    const { name, phone, sport, age, time, location } = req.body;
    if (!name || !phone || !sport) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }
    await saveLead({ customerName: name, mobileNumber: phone, leadCategory: sport, address: location || "" });

    const adminMsg =
      `🌐 *New Website Lead!*\n\n👤 Name: ${name}\n📞 Phone: ${phone}\n🏅 Sport: ${sport}\n` +
      `🕐 Age: ${age || "-"} | Time: ${time || "-"}\n📍 Location: ${location || "Not provided"}`;

    try {
      await sendTextMessage(process.env.ADMIN_PHONE, adminMsg);
      logger.info("Admin notified of website lead");
    } catch (err) {
      logger.error("Admin notify failed:", err.response?.data || err.message);
    }
    res.json({ success: true });
  } catch (err) {
    logger.error("Website lead error:", err.message);
    res.status(500).json({ success: false });
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
