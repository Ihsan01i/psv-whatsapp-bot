// ============================================================
// bot.js — Conversation flow & state management
// ============================================================

const { sendTextMessage, sendListMessage, sendButtonMessage } = require("./whatsapp");
const { saveLead } = require("./csv");

// ── In-memory state store ─────────────────────────────────────
// Key: phone number  |  Value: { step, name, category, address }
// NOTE: This resets if you restart the server.
// For production, use Redis or a simple JSON file.
const sessions = {};

// ── Sports options ────────────────────────────────────────────
const SPORTS = {
  badminton:      "🏸 Badminton",
  cricket:        "🏏 Cricket",
  archery:        "🏹 Archery",
  roller_skating: "🛼 Roller Skating",
};

// Category-specific info messages sent after selection
const SPORT_INFO = {
  badminton: `🏸 *Badminton at PSV Academy*\n\n📅 Batches: Mon-Sat | 6AM-8AM & 5PM-7PM\n💰 Fees: ₹1,500/month\n👟 Equipment provided for beginners\n\nCoach: Mr. Ravi Kumar (National Level)`,
  cricket:   `🏏 *Cricket at PSV Academy*\n\n📅 Batches: Tue, Thu, Sat | 6AM-9AM\n💰 Fees: ₹2,000/month\n🏟️ Full ground practice included\n\nCoach: Mr. Suresh (State Level)`,
  archery:   `🏹 *Archery at PSV Academy*\n\n📅 Batches: Mon, Wed, Fri | 5PM-7PM\n💰 Fees: ₹1,800/month\n🎯 All equipment provided\n\nCoach: Ms. Priya (FITA Certified)`,
  roller_skating: `🛼 *Roller Skating at PSV Academy*\n\n📅 Batches: Daily | 4PM-6PM\n💰 Fees: ₹1,200/month\n⛸️ Skates provided for first month\n\nCoach: Mr. Arun (State Champion)`,
};

// ── Main handler (called from server.js) ─────────────────────
async function handleIncomingMessage(message, contact) {
  const phone = message.from;                          // e.g. "919876543210"
  const name  = contact?.profile?.name || "Unknown";  // WhatsApp profile name
  const type  = message.type;                         // "text", "interactive", etc.

  // Get or create session for this user
  if (!sessions[phone]) {
    sessions[phone] = { step: "new", name, phone };
  }
  const session = sessions[phone];
  session.name = name; // Refresh name each time

  console.log(`📨 From: ${phone} | Step: ${session.step} | Type: ${type}`);

  // ── Route based on current step ───────────────────────────
  switch (session.step) {

    case "new":
      await sendWelcome(phone, name);
      session.step = "awaiting_sport";
      break;

    case "awaiting_sport":
      await handleSportSelection(session, message);
      break;

    case "awaiting_address":
      await handleAddressStep(session, message);
      break;

    case "completed":
      // Conversation already done — restart if they message again
      sessions[phone] = { step: "new", name, phone };
      await sendWelcome(phone, name);
      sessions[phone].step = "awaiting_sport";
      break;

    default:
      await sendWelcome(phone, name);
      session.step = "awaiting_sport";
  }
}

// ── Step 1: Welcome + sport list ──────────────────────────────
async function sendWelcome(phone, name) {
  const greeting = `👋 Welcome to *PSV Sports Academy*, ${name}!\n\nWe offer world-class coaching to shape tomorrow's champions. 🏆\n\nPlease select the sport you're interested in:`;

  // Send as interactive list (shows nicely in WhatsApp)
  await sendListMessage(phone, greeting, "Choose Sport", [
    { id: "badminton",      title: "🏸 Badminton",      description: "Mon-Sat | ₹1,500/mo" },
    { id: "cricket",        title: "🏏 Cricket",         description: "3 days/week | ₹2,000/mo" },
    { id: "archery",        title: "🏹 Archery",          description: "3 days/week | ₹1,800/mo" },
    { id: "roller_skating", title: "🛼 Roller Skating",   description: "Daily | ₹1,200/mo" },
  ]);
}

// ── Step 2: Handle sport selection ───────────────────────────
async function handleSportSelection(session, message) {
  const phone = session.phone;
  let sportKey = null;

  // User can reply via interactive list OR type the name
  if (message.type === "interactive") {
    const reply = message.interactive?.list_reply || message.interactive?.button_reply;
    sportKey = reply?.id?.toLowerCase();
  } else if (message.type === "text") {
    const text = message.text?.body?.toLowerCase().trim();
    // Match by keyword
    if (text.includes("badminton"))      sportKey = "badminton";
    else if (text.includes("cricket"))   sportKey = "cricket";
    else if (text.includes("archery"))   sportKey = "archery";
    else if (text.includes("skating") || text.includes("roller")) sportKey = "roller_skating";
  }

  if (!sportKey || !SPORT_INFO[sportKey]) {
    // Invalid selection — re-prompt
    await sendTextMessage(phone, "❗ Please select a sport from the list below:");
    await sendListMessage(phone, "Choose your sport:", "Choose Sport", [
      { id: "badminton",      title: "🏸 Badminton",      description: "Mon-Sat | ₹1,500/mo" },
      { id: "cricket",        title: "🏏 Cricket",         description: "3 days/week | ₹2,000/mo" },
      { id: "archery",        title: "🏹 Archery",          description: "3 days/week | ₹1,800/mo" },
      { id: "roller_skating", title: "🛼 Roller Skating",   description: "Daily | ₹1,200/mo" },
    ]);
    return;
  }

  // Save selected sport to session
  session.category = SPORTS[sportKey];
  session.sportKey = sportKey;

  // Send sport-specific info
  await sendTextMessage(phone, SPORT_INFO[sportKey]);

  // Ask for address (optional)
  await sendButtonMessage(
    phone,
    `📍 *One last step!*\n\nWould you like to share your address?\nThis helps us suggest the nearest batch location.\n\n_(You can skip this — it's optional)_`,
    [
      { id: "share_address", title: "📍 Share Address" },
      { id: "skip_address",  title: "⏭️ Skip" },
    ]
  );

  session.step = "awaiting_address";
}

// ── Step 3: Handle address step ───────────────────────────────
async function handleAddressStep(session, message) {
  const phone = session.phone;

  let address = "";
  let skipped = false;

  if (message.type === "interactive") {
    const reply = message.interactive?.button_reply;
    if (reply?.id === "skip_address") {
      skipped = true;
    } else if (reply?.id === "share_address") {
      // They clicked "Share Address" — ask them to type it
      await sendTextMessage(phone, "✏️ Please type your address below (area, city is enough):");
      session.step = "typing_address";
      return;
    }
  } else if (message.type === "text") {
    address = message.text?.body?.trim() || "";
    if (address.toLowerCase() === "skip" || address === "") {
      skipped = true;
    }
  }

  session.address = skipped ? "" : address;
  await completeLead(session);
}

// Called when user is in typing_address sub-step
async function handleIncomingMessage_typing(session, message) {
  // This is handled via the switch — we re-route here
}

// ── Step 4: Save lead & confirm ───────────────────────────────
async function completeLead(session) {
  const phone = session.phone;

  const lead = {
    customerName: session.name,
    mobileNumber: phone,
    leadCategory: session.category,
    address:      session.address || "",
    leadSource:   "WhatsApp Bot",
    priority:     "Medium",
    leadStatus:   "New",
  };

  await saveLead(lead);

  const confirmMsg =
    `✅ *Thank you, ${session.name}!*\n\n` +
    `Your enquiry has been registered with PSV Sports Academy.\n\n` +
    `📋 *Your Details:*\n` +
    `• Sport: ${session.category}\n` +
    `• Mobile: +${phone}\n` +
    (session.address ? `• Address: ${session.address}\n` : "") +
    `\n🏆 Our team will contact you shortly to confirm your batch.\n\n` +
    `For urgent queries: 📞 Call us at +91-XXXXXXXXXX\n\n` +
    `_PSV Sports Academy — Building Champions!_ 🌟`;

  await sendTextMessage(phone, confirmMsg);
  session.step = "completed";
}

// ── Handle typing_address step separately ─────────────────────
// We patch handleIncomingMessage to route this step too
const _orig = handleIncomingMessage;
module.exports = {
  handleIncomingMessage: async (message, contact) => {
    const phone = message.from;
    if (sessions[phone]?.step === "typing_address") {
      const session = sessions[phone];
      const address = message.text?.body?.trim() || "";
      session.address = address;
      await completeLead(session);
      return;
    }
    await _orig(message, contact);
  },
};
