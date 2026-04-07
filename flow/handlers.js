/**
 * handlers.js — One handler per conversation step.
 *
 * Migrated from the inline functions in bot.js:
 *   sendSportMenu()         → handleNew()
 *   handleSportChoice()     → handleAwaitingSport()
 *   handleBadmintonOption() → handleAwaitingSubOption()  ← now GENERIC, not Badminton-specific
 *   handleName()            → handleAwaitingName()
 *   handleLocation()        → handleAwaitingLocation()
 *   sendSportInfoAndSave()  → handleTypingLocation() + completion logic
 *
 * Key improvement: sub-option handling is now fully generic.
 * No sport names appear in any handler logic.
 */

const { sendTextMessage, sendListMessage, sendButtonMessage } = require("../whatsapp");
const { updateSession }   = require("../services/session");
const { processLead }     = require("../services/lead");
const {
  buildSportMenuRows,
  buildSubOptionButtons,
  getSportData,
  resolveLeadMeta,
  resolveSubOptionMeta,
  resolveSportKey,
  resolveSubOptionKey,
  isSkipLocation,
  isShareLocationButton,
  isValidName,
  extractText,
} = require("./utils");
const logger = require("../utils/logger");

// ─────────────────────────────────────────────
// Step: new / completed → show sport menu
// ─────────────────────────────────────────────

async function handleNew(phone, session) {
  const { rows, menuMap } = buildSportMenuRows();

  updateSession(phone, { step: "awaiting_sport", menuMap });

  await sendListMessage(
    phone,
    `👋 Welcome to *PSV Sports Academy!*\n\nWe offer professional coaching across multiple sports. 🏆\n\nPlease select the sport you are interested in:`,
    "View Sports",
    rows
  );

  logger.info(`[Flow] Sport menu sent to ${phone}`);
}

// ─────────────────────────────────────────────
// Step: awaiting_sport
// ─────────────────────────────────────────────

async function handleAwaitingSport(phone, session, message) {
  const sportKey = resolveSportKey(message, session.menuMap);

  if (!sportKey) {
    await sendTextMessage(phone, "❗ Please select a sport from the list:");
    await handleNew(phone, session);
    return;
  }

  const sport = getSportData(sportKey);
  updateSession(phone, { sportKey });

  if (sport.hasSubOptions) {
    // Show sub-option buttons (generic — works for any sport)
    const { buttons, subMenuMap } = buildSubOptionButtons(sportKey);
    updateSession(phone, { step: "awaiting_sub_option", subMenuMap });

    await sendButtonMessage(
      phone,
      `${sport.name}\n\nWhat are you interested in?`,
      buttons
    );
    logger.info(`[Flow] Sub-option menu sent for "${sportKey}" to ${phone}`);
  } else {
    // Direct sport — skip sub-option, go straight to name
    updateSession(phone, { step: "awaiting_name" });
    await sendTextMessage(phone, "✏️ Please enter your *name* so we can get back to you:");
    logger.info(`[Flow] Sport "${sportKey}" selected by ${phone} — asking name`);
  }
}

// ─────────────────────────────────────────────
// Step: awaiting_sub_option (GENERIC — not Badminton-specific)
// ─────────────────────────────────────────────

async function handleAwaitingSubOption(phone, session, message) {
  const optionKey = resolveSubOptionKey(message, session.subMenuMap);

  if (!optionKey) {
    // Re-show the sub-option buttons
    const { buttons } = buildSubOptionButtons(session.sportKey);
    await sendButtonMessage(phone, "Please choose one of the options:", buttons);
    return;
  }

  // Store the resolved option key as sportKey (used for tab + message resolution)
  updateSession(phone, { sportKey: optionKey, step: "awaiting_name" });
  await sendTextMessage(phone, "✏️ Please enter your *name* so we can get back to you:");
  logger.info(`[Flow] Sub-option "${optionKey}" selected by ${phone}`);
}

// ─────────────────────────────────────────────
// Step: awaiting_name
// ─────────────────────────────────────────────

async function handleAwaitingName(phone, session, message) {
  if (message.type !== "text") {
    await sendTextMessage(phone, "Please type your name:");
    return;
  }

  const text = extractText(message);

  if (!isValidName(text)) {
    await sendTextMessage(phone, "Please type your *full name* (at least 2 characters):");
    return;
  }

  updateSession(phone, { name: text, step: "awaiting_location" });

  await sendButtonMessage(
    phone,
    `📍 Hi *${text}!* Could you share your *location/area*?\nThis helps us suggest the nearest centre.\n\n_(You can skip this)_`,
    [
      { id: "share_location", title: "📍 Share Location" },
      { id: "skip_location",  title: "⏭️ Skip" },
    ]
  );

  logger.info(`[Flow] Name collected for ${phone}: "${text}"`);
}

// ─────────────────────────────────────────────
// Step: awaiting_location (button choice)
// ─────────────────────────────────────────────

async function handleAwaitingLocation(phone, session, message) {
  if (isSkipLocation(message)) {
    // User skipped — complete the flow with no location
    await completeFlow(phone, { ...session, location: "" });
    return;
  }

  if (isShareLocationButton(message)) {
    // User clicked "Share Location" — ask them to type it
    updateSession(phone, { step: "typing_location" });
    await sendTextMessage(phone, "✏️ Please type your area/city:");
    return;
  }

  // User typed a location directly (text message at this step)
  const text = extractText(message);
  if (text) {
    await completeFlow(phone, { ...session, location: text });
    return;
  }

  // Fallback — re-prompt
  await sendButtonMessage(
    phone,
    "Please share your location or skip:",
    [
      { id: "share_location", title: "📍 Share Location" },
      { id: "skip_location",  title: "⏭️ Skip" },
    ]
  );
}

// ─────────────────────────────────────────────
// Step: typing_location (user is typing their area)
// ─────────────────────────────────────────────

async function handleTypingLocation(phone, session, message) {
  const text = extractText(message);
  await completeFlow(phone, { ...session, location: text });
}

// ─────────────────────────────────────────────
// Step: completed
// ─────────────────────────────────────────────

async function handleCompleted(phone) {
  await sendTextMessage(
    phone,
    `You've already completed your enquiry! 🎉\n\nType *menu* to explore other sports.`
  );
}

// ─────────────────────────────────────────────
// Completion: send info + save lead + confirm
// (Migrated from sendSportInfoAndSave in bot.js)
// ─────────────────────────────────────────────

async function completeFlow(phone, session) {
  // Resolve tab name and info message from the sportKey
  // sportKey may be a sub-option key (e.g. "badminton_coaching") or direct (e.g. "archery")
  let tabName, message;

  // Try sub-option resolution first (e.g. "badminton_coaching")
const subMeta = resolveSubOptionMeta(session.sportKey);

  if (subMeta.tabName !== session.sportKey) {
  tabName = subMeta.tabName;
  message = subMeta.message;
} else {
  const direct = resolveLeadMeta(session.sportKey);
  tabName = direct.tabName;
  message = direct.message;
}

  // 1. Send sport info
  await sendTextMessage(phone, message);

  // 2. Save lead + notify admin (parallel, both fault-tolerant)
  await processLead({ ...session, location: session.location || "" }, tabName);

  // 3. Confirmation message — exact format from original bot.js
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

  updateSession(phone, { step: "completed", location: session.location || "" });
  logger.info(`[Flow] Flow completed for ${phone} — interest: "${tabName}"`);
}

module.exports = {
  handleNew,
  handleAwaitingSport,
  handleAwaitingSubOption,
  handleAwaitingName,
  handleAwaitingLocation,
  handleTypingLocation,
  handleCompleted,
};
