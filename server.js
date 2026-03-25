// ============================================================
// PSV SPORTS ACADEMY - WhatsApp Lead Bot
// server.js — Main entry point
// ============================================================

require("dotenv").config(); // Load .env file FIRST

const express = require("express");
const bodyParser = require("body-parser");
const { handleIncomingMessage } = require("./bot");

const app = express();
app.use(bodyParser.json());

// ── 1. WEBHOOK VERIFICATION ──────────────────────────────────
// Meta calls this once to verify your webhook URL is real.
// It sends a "hub.challenge" and you must echo it back.
app.get("/webhook", (req, res) => {
  const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "psv_sports_token";

  const mode      = req.query["hub.mode"];
  const token     = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  console.log("Token received:", token);
  console.log("Token expected:", VERIFY_TOKEN);

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verified by Meta!");
    return res.status(200).send(challenge); // Echo challenge back
  }
  console.error("❌ Webhook verification failed. Check VERIFY_TOKEN.");
  res.sendStatus(403);
});

// ── 2. RECEIVE MESSAGES ──────────────────────────────────────
// Meta sends every incoming WhatsApp message here as a POST.
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    // Make sure this is a WhatsApp message event
    if (
      body.object === "whatsapp_business_account" &&
      body.entry?.[0]?.changes?.[0]?.value?.messages?.[0]
    ) {
      const change  = body.entry[0].changes[0].value;
      const message = change.messages[0];
      const contact = change.contacts?.[0]; // Contains profile name

      await handleIncomingMessage(message, contact);
    }

    // Always reply 200 quickly — Meta will retry if you don't
    res.sendStatus(200);
  } catch (err) {
    console.error("Error handling message:", err);
    res.sendStatus(200); // Still send 200 so Meta doesn't retry
  }
});

// ── 3. START SERVER ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 PSV Bot server running on port ${PORT}`);
  console.log(`📡 Webhook URL: https://YOUR_DOMAIN/webhook`);
});
