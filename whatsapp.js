// ============================================================
// whatsapp.js — Functions to send messages via Meta Cloud API
// ============================================================

const axios = require("axios");
require("dotenv").config();

// Read credentials from environment variables (see .env file)
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // From Meta Developer Dashboard
// NOTE: ACCESS_TOKEN is intentionally NOT cached at module load — read at call time
// so that secret rotation (Railway redeploy / env update) takes effect immediately.

const API_URL = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

// ── Shared header for all API calls ──────────────────────────
// Read ACCESS_TOKEN at call-time (not module load) to support live rotation.
const headers = () => ({
  Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
  "Content-Type": "application/json",
});

// ── Helper: Make the API call ─────────────────────────────────
async function callAPI(payload) {
  try {
    const res = await axios.post(API_URL, payload, { headers: headers(), timeout: 30000 });
    console.log(`✅ Message sent | ID: ${res.data.messages?.[0]?.id}`);
    return res.data;
  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error("❌ WhatsApp API error:", JSON.stringify(errData, null, 2));
    throw err;
  }
}

// ── 1. Send plain text message ────────────────────────────────
async function sendTextMessage(to, text) {
  return callAPI({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text, preview_url: false },
  });
}

// ── 2. Send interactive LIST (for selecting sport) ────────────
// rows = [{ id, title, description }, ...]
async function sendListMessage(to, bodyText, buttonLabel, rows) {
  return callAPI({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: bodyText },
      action: {
        button: buttonLabel, // Button label that opens the list
        sections: [
          {
            title: "Available Sports",
            rows: rows.map((r) => ({
              id:          r.id,
              title:       r.title,
              description: r.description || "",
            })),
          },
        ],
      },
    },
  });
}

// ── 3. Send interactive BUTTONS (for yes/no type questions) ───
// buttons = [{ id, title }, ...]  (max 3 buttons)
async function sendButtonMessage(to, bodyText, buttons) {
  return callAPI({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: bodyText },
      action: {
        buttons: buttons.map((b) => ({
          type:  "reply",
          reply: { id: b.id, title: b.title },
        })),
      },
    },
  });
}

module.exports = { sendTextMessage, sendListMessage, sendButtonMessage };
