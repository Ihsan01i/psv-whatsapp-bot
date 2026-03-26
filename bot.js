// ============================================================
// bot.js — PSV Sports Academy WhatsApp Bot
// FLOW:
// 1. User messages → Sport list
// 2. Badminton → Coaching or Court Booking?
// 3. Ask Name
// 4. Ask Location (optional)
// 5. Send sport-specific info
// 6. Save to Google Sheets + Notify admin
// 7. Confirm to user
// ============================================================

const { sendTextMessage, sendListMessage, sendButtonMessage } = require("./whatsapp");
const { saveLead } = require("./sheets");
const fs           = require("fs");
const SESSION_FILE = "./sessions.json";

// ── Session persistence ───────────────────────────────────────
let sessions = {};
try {
  if (fs.existsSync(SESSION_FILE)) {
    sessions = JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
    console.log(`📂 Restored ${Object.keys(sessions).length} sessions`);
  }
} catch (e) { sessions = {}; }

function saveSessions() {
  try { fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2)); }
  catch (e) { console.error("Session save error:", e.message); }
}

// ── Sport info (sent AFTER name + location collected) ─────────
const SPORT_INFO = {

  badminton_coaching: `🏸 *PSV Badminton Academy — Coaching*

📍 *Locations:*
1. PSV Badminton Court, Shareca Lane, Behind Joy Alukkas Gold Tower, Vazhakkala
2. Nava Sports Center, Annex Road, Desiyamukku, Vazhakkala

⏰ *Adult Batches:*
• 6:30 AM – 8:30 AM
• 7:30 AM – 9:30 AM
• 8:30 AM – 10:30 AM
• 6:30 PM – 8:30 PM
• 7:30 PM – 9:30 PM
• 8:30 PM – 10:30 PM

👦 *Kids Batches:*
• 5:00 PM – 6:30 PM
• Parents accompanying kids can also attend!
• Weekend sessions available ✅

💰 *Adult Packages:*
1. 20 days/month — ₹4,000
2. 16 days/month — ₹3,500
3. 12 days/month — ₹3,000
4. 8 days/month — ₹2,500
5. 30 sessions in 2 months — ₹5,000

💰 *Kids Packages:*
1. 20 days/month — ₹3,000
2. 12 days/month — ₹2,500
3. 8 days/month — ₹2,000

📞 Call/WhatsApp: *+91 9509502000*`,

  badminton_court: `🏸 *PSV Badminton — Court Booking*

We have 2 court locations in Vazhakkala & Desiyamukku!

1️⃣ *PSV Badminton Court*
📍 https://maps.app.goo.gl/SQ7LZMtDhCpwepsh6
🔗 Book: https://book.playspots.in/venues/psv-badminton-academy-shareca-lane-vazhakkala

2️⃣ *PSV–Nava Badminton Court*
📍 https://maps.app.goo.gl/N7VYk8C4q7XeTWZB6
🔗 Book: https://book.playspots.in/venues/nava-sports-centre

For group/monthly bookings:
📞 *+91 9509502000*`,

  archery: `🏹 *Archery Classes by PSV*

Professional coaching by Pro Sports Ventures (PSV)

📍 *Location:* Nava Nirman School, Annex Road, Desiyamukku, Vazhakkala
🗓 *Days:* Monday – Friday
⏰ *Time:* 4:00 PM – 6:00 PM

💰 *Packages:*
• ₹2,500 — 2 days/week (8 sessions/month)
• ₹3,000 — 3 days/week (12 sessions/month)

🎯 Classes start: 1st week of April
📞 Book a FREE demo: *+91 9509502000*`,

  basketball: `🏀 *Basketball Coaching — Adults & Kids*
ABC Indoor Basketball Academy

🔥 *Coaching Batches:*

👦 Beginners (Under 15)
⏰ 6:15 PM – 7:30 PM | Mon – Thu

🧑 Beginners (Above 15 years)
⏰ 5:00 PM – 6:30 PM | Fri, Sat & Sun

🏀 Intermediate / Advanced / Pro
⏰ 7:30 PM – 9:30 PM | Mon – Fri

💰 *Fee Packages:*
• 12 Sessions — ₹2,500
• 15 Sessions — ₹3,500
• 20 Sessions — ₹4,000

⭐ *Special Services:*
• Personal Training (15 sessions) — ₹5,000
• Team Training (School/College/IT) — ₹2,000/session

📞 Call/WhatsApp: *+91 9509502000*`,

  roller_skating: `🛼 *Roller Skating Classes — Adults & Kids*

🎯 Structured & monitored sessions
👨‍🏫 Expert coaches
⚖️ Balance • Fitness • Confidence

👶 Kids: 3 years onwards
🧑 Adults: No age limit!

💰 *Fees:*
• 2 sessions/week — ₹2,500/month
• 3 sessions/week — ₹3,500/month

📍 *Location:* Nava Nirman School, Vayu Sena Road, Kakkanad
🗺 https://maps.app.goo.gl/MuZtZsZLMcjAXfQK9

⏰ Mon – Thu | 4:00 PM – 6:00 PM

🎁 *Free demo session available for everyone!*
📞 Call/WhatsApp: *+91 9509502000*`,
};

// Google Sheets tab names
const TAB_NAMES = {
  badminton_coaching: "Badminton - Coaching",
  badminton_court:    "Badminton - Court Booking",
  archery:            "Archery",
  basketball:         "Basketball",
  roller_skating:     "Roller Skating",
};

// ── Main handler ──────────────────────────────────────────────
async function handleIncomingMessage(message, contact) {
  const phone  = message.from;
  const waName = contact?.profile?.name || "Unknown";

  if (!sessions[phone]) {
    sessions[phone] = { step: "new", waName, phone };
    saveSessions();
  }
  const session  = sessions[phone];
  session.waName = waName;

  console.log(`📨 ${phone} | step: ${session.step} | type: ${message.type}`);

  // Handle free-text steps first (outside switch)
  if (session.step === "awaiting_name") {
    await handleName(session, message);
    return;
  }
  if (session.step === "typing_location") {
    session.location = message.text?.body?.trim() || "";
    await sendSportInfoAndSave(session);
    return;
  }

  switch (session.step) {
    case "new":
    case "completed":
      sessions[phone] = { step: "awaiting_sport", waName, phone };
      saveSessions();
      await sendSportMenu(phone);
      break;

    case "awaiting_sport":
      await handleSportChoice(session, message);
      break;

    case "awaiting_badminton_option":
      await handleBadmintonOption(session, message);
      break;

    case "awaiting_location":
      await handleLocation(session, message);
      break;

    default:
      sessions[phone] = { step: "awaiting_sport", waName, phone };
      saveSessions();
      await sendSportMenu(phone);
  }
}

// ── Step 1: Sport menu ────────────────────────────────────────
async function sendSportMenu(phone) {
  await sendListMessage(
    phone,
    `👋 Welcome to *PSV Sports Academy!*\n\nWe offer professional coaching across multiple sports. 🏆\n\nPlease select the sport you are interested in:`,
    "View Sports",
    [
      { id: "badminton",      title: "🏸 Badminton",     description: "Coaching & Court Booking" },
      { id: "archery",        title: "🏹 Archery",        description: "Mon–Fri | 4–6 PM" },
      { id: "basketball",     title: "🏀 Basketball",     description: "Kids & Adults batches" },
      { id: "roller_skating", title: "🛼 Roller Skating", description: "From 3 years | Free demo" },
    ]
  );
}

// ── Step 2: Handle sport choice ───────────────────────────────
async function handleSportChoice(session, message) {
  const phone = session.phone;
  let sportKey = null;

  if (message.type === "interactive") {
    const reply = message.interactive?.list_reply || message.interactive?.button_reply;
    sportKey = reply?.id?.toLowerCase();
  } else if (message.type === "text") {
    const t = message.text?.body?.toLowerCase().trim();
    if (t.includes("badminton"))                           sportKey = "badminton";
    else if (t.includes("archery"))                        sportKey = "archery";
    else if (t.includes("basket"))                         sportKey = "basketball";
    else if (t.includes("skate") || t.includes("roller")) sportKey = "roller_skating";
  }

  if (!sportKey) {
    await sendTextMessage(phone, "❗ Please select a sport from the list:");
    await sendSportMenu(phone);
    return;
  }

  // Badminton needs sub-option before asking name
  if (sportKey === "badminton") {
    session.step = "awaiting_badminton_option";
    saveSessions();
    await sendButtonMessage(
      phone,
      `🏸 *PSV Badminton Academy*\n\nWhat are you interested in?`,
      [
        { id: "badminton_coaching", title: "🎓 Coaching" },
        { id: "badminton_court",    title: "🏟️ Court Booking" },
      ]
    );
    return;
  }

  // For all other sports — go straight to asking name
  session.sportKey = sportKey;
  session.step     = "awaiting_name";
  saveSessions();
  await sendTextMessage(phone, "✏️ Please enter your *name* so we can get back to you:");
}

// ── Step 2b: Badminton sub-option → then ask name ─────────────
async function handleBadmintonOption(session, message) {
  const phone = session.phone;
  let key = null;

  if (message.type === "interactive") {
    key = message.interactive?.button_reply?.id;
  } else if (message.type === "text") {
    const t = message.text?.body?.toLowerCase().trim();
    if (t.includes("coach"))                         key = "badminton_coaching";
    else if (t.includes("court") || t.includes("book")) key = "badminton_court";
  }

  if (!key) {
    await sendButtonMessage(
      phone,
      `Please choose one of the options:`,
      [
        { id: "badminton_coaching", title: "🎓 Coaching" },
        { id: "badminton_court",    title: "🏟️ Court Booking" },
      ]
    );
    return;
  }

  // Sport key confirmed — now ask name
  session.sportKey = key;
  session.step     = "awaiting_name";
  saveSessions();
  await sendTextMessage(phone, "✏️ Please enter your *name* so we can get back to you:");
}

// ── Step 3: Collect name ──────────────────────────────────────
async function handleName(session, message) {
  const phone = session.phone;

  if (message.type !== "text" || !message.text?.body?.trim()) {
    await sendTextMessage(phone, "Please type your name:");
    return;
  }

  session.name = message.text.body.trim();
  session.step = "awaiting_location";
  saveSessions();

  await sendButtonMessage(
    phone,
    `📍 Hi *${session.name}!* Could you share your *location/area*?\nThis helps us suggest the nearest centre.\n\n_(You can skip this)_`,
    [
      { id: "share_location", title: "📍 Share Location" },
      { id: "skip_location",  title: "⏭️ Skip" },
    ]
  );
}

// ── Step 4: Collect location → then send info ─────────────────
async function handleLocation(session, message) {
  const phone = session.phone;

  if (message.type === "interactive") {
    const reply = message.interactive?.button_reply;
    if (reply?.id === "skip_location") {
      session.location = "";
      await sendSportInfoAndSave(session);
    } else if (reply?.id === "share_location") {
      session.step = "typing_location";
      saveSessions();
      await sendTextMessage(phone, "✏️ Please type your area/city:");
    }
  } else if (message.type === "text") {
    const t = message.text?.body?.trim();
    session.location = (!t || t.toLowerCase() === "skip") ? "" : t;
    await sendSportInfoAndSave(session);
  }
}

// ── Step 5: Send sport info → Save → Notify → Confirm ────────
async function sendSportInfoAndSave(session) {
  const phone   = session.phone;
  const tabName = TAB_NAMES[session.sportKey] || session.sportKey;

  // Send the sport info message
  await sendTextMessage(phone, SPORT_INFO[session.sportKey]);

  // Save lead to Google Sheets
  const lead = {
    customerName: session.name,
    mobileNumber: phone,
    leadCategory: tabName,
    address:      session.location || "",
  };

  try {
    await saveLead(lead);
  } catch (err) {
    console.error("❌ Sheets save failed:", err.message);
  }

  // Notify admin
  await notifyAdmin(lead);

  // Confirmation message
  const confirm =
    `✅ *Thank you, ${session.name}!*\n\n` +
    `We've received your enquiry and will contact you shortly.\n\n` +
    `📋 *Your Details:*\n` +
    `• Interest: ${tabName}\n` +
    `• Mobile: +${phone}\n` +
    (session.location ? `• Location: ${session.location}\n` : "") +
    `\n📞 For urgent queries: *+91 9509502000*\n\n` +
    `_PSV Sports Academy — Building Champions!_ 🌟`;

  await sendTextMessage(phone, confirm);

  session.step = "completed";
  saveSessions();
}

// ── Admin notification ────────────────────────────────────────
async function notifyAdmin(lead) {
  const adminPhone = process.env.ADMIN_PHONE;

  if (!adminPhone) {
    console.warn("⚠️ ADMIN_PHONE missing");
    return;
  }

  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const msg =
    `🔔 *New Lead — PSV Sports Academy*\n\n` +
    `👤 Name: ${lead.customerName}\n` +
    `📱 Mobile: +${lead.mobileNumber}\n` +
    `🏅 Interest: ${lead.leadCategory}\n` +
    `📍 Location: ${lead.address || "Not provided"}\n` +
    `🕐 Time: ${now}`;

  try {
    await sendTextMessage(adminPhone, msg);
    console.log("✅ Admin message sent");
  } catch (err) {
    console.error("❌ Admin notify failed:", err.response?.data || err.message);
  }
}

module.exports = { handleIncomingMessage };