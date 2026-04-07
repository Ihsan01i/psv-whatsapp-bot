/**
 * bot.js — PSV Sports Academy WhatsApp Bot: Main message router.
 *
 * This replaces the original monolithic bot.js.
 * All step logic lives in flow/handlers.js — this file only routes.
 *
 * Flow:
 *   new → awaiting_sport → [awaiting_sub_option] → awaiting_name
 *       → awaiting_location → [typing_location] → completed
 */

const { getSession, updateSession, resetSession } = require("./services/session");
const {
  handleNew,
  handleAwaitingSport,
  handleAwaitingSubOption,
  handleAwaitingName,
  handleAwaitingLocation,
  handleTypingLocation,
  handleCompleted,
} = require("./flow/handlers");
const { extractText, isRestartTrigger } = require("./flow/utils");
const { sendTextMessage } = require("./whatsapp");
const logger = require("./utils/logger");

// ── Step → handler map ────────────────────────────────────────
// To add a new step: add one line here + one handler in handlers.js
const STEP_HANDLERS = {
  new:                  (phone, session, msg) => handleNew(phone, session),
  awaiting_sport:       (phone, session, msg) => handleAwaitingSport(phone, session, msg),
  awaiting_sub_option:  (phone, session, msg) => handleAwaitingSubOption(phone, session, msg),
  awaiting_name:        (phone, session, msg) => handleAwaitingName(phone, session, msg),
  awaiting_location:    (phone, session, msg) => handleAwaitingLocation(phone, session, msg),
  typing_location:      (phone, session, msg) => handleTypingLocation(phone, session, msg),
  completed:            (phone, session, msg) => handleCompleted(phone),
};

/**
 * Entry point — called from server.js for every incoming WhatsApp message.
 *
 * @param {object} message - Raw WhatsApp message object from the webhook
 * @param {object} contact - WhatsApp contact object ({ profile: { name } })
 */
async function handleIncomingMessage(message, contact) {
  const phone  = message.from;
  const waName = contact?.profile?.name || "";

  if (!phone) {
    logger.warn("[Bot] Message received with no phone number — skipping");
    return;
  }

  const text = extractText(message);
  logger.info(`[Bot] ${phone} | type: ${message.type} | text: "${text}"`);

  // ── Restart trigger: reset and show main menu ─────────────
  if (text && isRestartTrigger(text)) {
    logger.info(`[Bot] Restart triggered by ${phone}`);
    resetSession(phone, waName);
  }

  // ── Get/refresh session ───────────────────────────────────
  const session = getSession(phone);

  // Always keep waName fresh from WhatsApp profile
  if (waName) updateSession(phone, { waName });

  const step = session.step;
  logger.info(`[Bot] ${phone} | step: "${step}"`);

  // ── Route to handler ──────────────────────────────────────
  const handler = STEP_HANDLERS[step];

  if (!handler) {
    logger.error(`[Bot] Unknown step "${step}" for ${phone} — resetting`);
    resetSession(phone, waName);
    await sendTextMessage(phone, "⚠️ Something went wrong. Let's start fresh!\n\nType *menu* to begin.");
    return;
  }

  try {
    await handler(phone, session, message);
  } catch (err) {
    logger.error(`[Bot] Error in step "${step}" for ${phone}:`, err.message, err.stack);
    try {
      await sendTextMessage(
        phone,
        "⚠️ We hit a technical issue. Please try again or type *menu* to restart."
      );
    } catch (sendErr) {
      logger.error(`[Bot] Failed to send error message to ${phone}:`, sendErr.message);
    }
  }
}

module.exports = { handleIncomingMessage };
