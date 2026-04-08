// ============================================================
// lead.js — Lead processing: save to Supabase + notify admin
//
// REPLACES the original lead.js
// Drop-in compatible: processLead(session, tabName) signature unchanged.
//
// Phone number normalisation:
//   WhatsApp "from" field already contains the full number without "+".
//   Website form may send "9876543210" (10-digit) → we prepend "91".
// ============================================================

const supabase            = require("./db");
const { sendTextMessage } = require("../whatsapp");
const logger              = require("../utils/logger");
const { normalizePhone }  = require("../utils/phone");

const ADMIN_PHONE = process.env.ADMIN_PHONE;

// ─────────────────────────────────────────────────────────────
// Phone normalisation
// WhatsApp numbers must be E.164 without the "+" e.g. "919876543210"
// ─────────────────────────────────────────────────────────────
function normalisePhone(raw) {
  try {
    return normalizePhone(raw, "IN");
  } catch (err) {
    logger.warn(`[Lead] Invalid phone fallback: ${raw}`);
    // Fallback if libphonenumber fails:
    const digits = String(raw || "").replace(/\D/g, "");
    if (digits.length === 12 && digits.startsWith("91")) return digits;
    if (digits.length === 10) return `91${digits}`;
    return digits;
  }
}

// ─────────────────────────────────────────────────────────────
// Save lead to Supabase
// ─────────────────────────────────────────────────────────────
async function saveLeadToSupabase(session, tabName) {
  const phone = normalisePhone(session.phone);

  const lead = {
    name:      session.name,
    phone,
    sport_key: session.sportKey  || "unknown",
    tab_name:  tabName           || session.sportKey,
    location:  session.location  || "",
    source:    session.source    || "whatsapp",
    wa_name:   session.waName    || "",
  };

  logger.info(`[Lead] Saving to Supabase: ${lead.name} | ${lead.sport_key}`);

  try {
    const { error } = await supabase
      .from("leads")
      .upsert(lead, {
        onConflict:        "phone,sport_key", // Matches the unique index in schema
        ignoreDuplicates:  false,             // Update existing row if re-enquiry
      });

    if (error) throw error;
    logger.info(`[Lead] Saved → "${tabName}" | phone: ${phone}`);
  } catch (err) {
    logger.error(`[Lead] Supabase save failed for ${phone}:`, err.message);
    // Non-fatal — flow continues
  }
}

// ─────────────────────────────────────────────────────────────
// Notify admin via WhatsApp
// (unchanged from original — still uses sendTextMessage)
// ─────────────────────────────────────────────────────────────
async function notifyAdmin(session, tabName) {
  if (!ADMIN_PHONE) {
    logger.warn("[Lead] ADMIN_PHONE not set — skipping admin notification");
    return;
  }

  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const phone = normalisePhone(session.phone);

  const msg =
    `🔔 *New Lead — PSV Sports Academy*\n\n` +
    `👤 Name: ${session.name}\n` +
    `📱 Mobile: +${phone}\n` +
    `🏅 Interest: ${tabName}\n` +
    `📍 Location: ${session.location || "Not provided"}\n` +
    `📥 Source: ${session.source || "whatsapp"}\n` +
    `🕐 Time: ${now}`;

  try {
    await sendTextMessage(ADMIN_PHONE, msg);
    logger.info(`[Lead] Admin notified (${ADMIN_PHONE})`);
  } catch (err) {
    logger.error(`[Lead] Admin notify failed:`, err.response?.data || err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Public API — run save + notify in parallel
// Same signature as the original lead.js
// ─────────────────────────────────────────────────────────────
async function processLead(session, tabName) {
  await Promise.allSettled([
    saveLeadToSupabase(session, tabName),
    notifyAdmin(session, tabName),
  ]);
}

// ─────────────────────────────────────────────────────────────
// Query helpers (used by bulk sender + admin routes)
// ─────────────────────────────────────────────────────────────

/**
 * Fetch leads filtered by sport_key and/or date range.
 * All parameters are optional.
 *
 * @param {object} filters
 * @param {string}  [filters.sportKey]   — e.g. "badminton_coaching"
 * @param {string}  [filters.source]     — "whatsapp" | "website"
 * @param {string}  [filters.since]      — ISO date string e.g. "2024-01-01"
 * @param {boolean} [filters.unMessaged] — only leads not bulk-messaged in last 7 days
 * @param {number}  [filters.limit]      — max rows (default 500)
 * @returns {Promise<Array>}
 */
async function fetchLeads({ sportKey, source, since, unMessaged, limit = 500 } = {}) {
  let query = supabase
    .from("leads")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (sportKey)    query = query.eq("sport_key", sportKey);
  if (source)      query = query.eq("source",    source);
  if (since)       query = query.gte("created_at", since);
  if (unMessaged)  query = query.or(
    "bulk_sent_at.is.null,bulk_sent_at.lt." +
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  );

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Mark a lead as having received a bulk message.
 * Called after a successful template send.
 */
async function markBulkSent(leadId) {
  const { error } = await supabase
    .from("leads")
    .update({ bulk_sent_at: new Date().toISOString() })
    .eq("id", leadId);

  if (error) logger.error(`[Lead] markBulkSent failed for lead ${leadId}:`, error.message);
}

module.exports = { processLead, fetchLeads, markBulkSent, normalisePhone };
