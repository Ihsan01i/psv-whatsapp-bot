/**
 * lead.js — Lead processing: save to Sheets + notify admin.
 *
 * Migrated from the inline notifyAdmin() and saveLead() calls
 * that were scattered through bot.js. Now centralised and resilient.
 *
 * Both operations run in parallel via Promise.allSettled —
 * a Sheets failure never blocks the admin notification and vice versa.
 */

const { saveLead }       = require("../sheets");
const { sendTextMessage } = require("../whatsapp");
const logger              = require("../utils/logger");

const ADMIN_PHONE = process.env.ADMIN_PHONE;

/**
 * Save lead to Google Sheets.
 * Errors are caught and logged — the user flow continues regardless.
 */
async function saveLeadToSheet(session, tabName) {
  const lead = {
    customerName: session.name,
    mobileNumber: session.phone,
    leadCategory: tabName,
    address:      session.location || "",
  };

  logger.info(`[Lead] Saving lead: ${session.name} | ${tabName}`);

  try {
    await saveLead(lead);
    logger.info(`[Lead] Saved to Sheets — tab: "${tabName}"`);
  } catch (err) {
    logger.error(`[Lead] Sheets save failed for ${session.phone}:`, err.message);
  }
}

/**
 * Send WhatsApp notification to admin.
 * Matches the exact message format from the original bot.js notifyAdmin().
 */
async function notifyAdmin(session, tabName) {
  if (!ADMIN_PHONE) {
    logger.warn("[Lead] ADMIN_PHONE not set — skipping admin notification");
    return;
  }

  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  const msg =
    `🔔 *New Lead — PSV Sports Academy*\n\n` +
    `👤 Name: ${session.name}\n` +
    `📱 Mobile: +${session.phone}\n` +
    `🏅 Interest: ${tabName}\n` +
    `📍 Location: ${session.location || "Not provided"}\n` +
    `🕐 Time: ${now}`;

  try {
    await sendTextMessage(ADMIN_PHONE, msg);
    logger.info(`[Lead] Admin notified (${ADMIN_PHONE})`);
  } catch (err) {
    logger.error(`[Lead] Admin notify failed:`, err.response?.data || err.message);
  }
}

/**
 * Run save + notify in parallel.
 * Individual failures are handled inside each function.
 */
async function processLead(session, tabName) {
  await Promise.allSettled([
    saveLeadToSheet(session, tabName),
    notifyAdmin(session, tabName),
  ]);
}

module.exports = { processLead };
