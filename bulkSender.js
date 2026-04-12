// ============================================================
// bulkSender.js — Bulk WhatsApp template messaging
//
// Uses Meta WhatsApp Cloud API (official — no Twilio).
// Reads leads from Supabase, sends approved template messages.
//
// Usage:
//   node bulkSender.js                              # sends to all unMessaged leads
//   node bulkSender.js --sport badminton_coaching   # filtered by sport
//   node bulkSender.js --sport archery --dry-run    # preview without sending
//
// ⚠️  POLICY REMINDER:
//   - Only send to users who have already messaged you (opted in via WhatsApp).
//   - All templates must be pre-approved in Meta Business Manager.
//   - Respect Meta's messaging limits to avoid quality rating drops.
// ============================================================

require("dotenv").config();
const axios  = require("axios");
const logger = require("./utils/logger");
const { fetchLeads, markBulkSent } = require("./services/lead");
const supabase = require("./services/db");

// ── Config ────────────────────────────────────────────────────
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
// NOTE: ACCESS_TOKEN is intentionally NOT cached at module load — read at call time
// so that secret rotation takes effect without a process restart.
const API_URL         = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

// Delay between each message send (milliseconds).
const GLOBAL_SEND_DELAY = 150;

// ── Approved template definitions ─────────────────────────────
// Each template maps to a pre-approved Meta Business Manager template.
// Template names must exactly match what's approved in your Meta account.
//
// Variables are positional: {{1}}, {{2}}, etc.
// The "components" builder below fills them dynamically from lead data.
//
// HOW TO CREATE A TEMPLATE IN META BUSINESS MANAGER:
//   1. Go to: business.facebook.com → WhatsApp Manager → Message Templates
//   2. Click "Create Template"
//   3. Category: MARKETING  (for promos) or UTILITY (for follow-ups)
//   4. Language: English (en)
//   5. Write your template body with {{1}}, {{2}} placeholders
//   6. Submit for review — approval usually takes minutes to hours
// ─────────────────────────────────────────────────────────────

const TEMPLATES = {

  // ── General follow-up (works for any sport)
  general_followup: {
    name:     "psv_general_followup",   // ← Must match approved template name exactly
    language: "en",
    /**
     * @param {object} lead — row from Supabase
     * @returns {Array}  WhatsApp components array
     */
    buildComponents: (lead) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: lead.name },        // {{1}} — customer name
          { type: "text", text: lead.tab_name },    // {{2}} — sport/programme name
        ],
      },
    ],
    // Template body (for your reference — must match what's approved):
    // "Hi {{1}}! 👋 This is PSV Sports Academy. You recently showed interest in *{{2}}*.
    //  We'd love to help you get started! Reply to this message or call us at +91 9509502000. 🏆"
  },

  // ── Badminton coaching — specific promo
  badminton_promo: {
    name:     "psv_badminton_promo",
    language: "en",
    buildComponents: (lead) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: lead.name },
        ],
      },
    ],
    // Template body:
    // "Hi {{1}}! 🏸 PSV Badminton Academy has new morning & evening batches starting soon.
    //  Packages from ₹2,500/month. Book a FREE demo today!
    //  📞 +91 9509502000  📍 Vazhakkala"
  },

  // ── Archery — new batch alert
  archery_batch: {
    name:     "psv_archery_batch",
    language: "en",
    buildComponents: (lead) => [
      {
        type: "body",
        parameters: [
          { type: "text", text: lead.name },
        ],
      },
    ],
  },

};

// ── Core: send one template message ──────────────────────────
/**
 * @param {string} phone      — E.164 without "+", e.g. "919876543210"
 * @param {object} template   — from TEMPLATES map
 * @param {object} lead       — Supabase lead row (for variable interpolation)
 * @returns {{ success: boolean, messageId?: string, error?: string }}
 */
async function sendTemplateMessage(phone, template, lead) {
  const payload = {
    messaging_product: "whatsapp",
    to:                phone,
    type:              "template",
    template: {
      name:       template.name,
      language:   { code: template.language },
      components: template.buildComponents(lead),
    },
  };

  try {
    const res = await axios.post(API_URL, payload, {
      headers: {
        Authorization:  `Bearer ${process.env.ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 30000, // 30 seconds — fail fast if Meta API hangs
    });

    const messageId = res.data?.messages?.[0]?.id;
    return { success: true, messageId };
  } catch (err) {
    const errData = err.response?.data?.error || err.message;
    return { success: false, error: JSON.stringify(errData) };
  }
}

// ── Logging: Persist Batch to Supabase ───────────────────────
async function persistBatch(successIds, logs) {
  if (successIds.length > 0) {
    const { error } = await supabase
      .from("leads")
      .update({ bulk_sent_at: new Date().toISOString() })
      .in("id", successIds);
    if (error) logger.error("[BulkSend] Failed to update bulk_sent_at batch:", error.message);
  }

  if (logs.length > 0) {
    const { error } = await supabase
      .from("bulk_send_log")
      .insert(logs);
    if (error) logger.error("[BulkSend] Failed to log send result batch:", error.message);
  }
}

// ── Delay helper ──────────────────────────────────────────────
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ── Main bulk send function ───────────────────────────────────
/**
 * Fetch leads and send template messages.
 *
 * @param {object}  options
 * @param {string}  [options.sportKey]      — Filter by sport_key (undefined = all sports)
 * @param {string}  [options.templateKey]   — Key from TEMPLATES map (default: "general_followup")
 * @param {boolean} [options.dryRun]        — Log without actually sending
 * @param {boolean} [options.onlyUnMessaged]— Skip leads messaged in last 7 days (default: true)
 * @param {number}  [options.limit]         — Max leads to process (default: 100)
 */
async function runBulkSend({
  sportKey        = null,
  templateKey     = "general_followup",
  dryRun          = false,
  onlyUnMessaged  = true,
  limit           = 100,
} = {}) {
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown template key: "${templateKey}"`);

  logger.info(`[BulkSend] Starting bulk send`);
  logger.info(`[BulkSend] Template  : ${template.name}`);
  logger.info(`[BulkSend] Sport key : ${sportKey || "(all)"}`);
  logger.info(`[BulkSend] Dry run   : ${dryRun}`);
  logger.info(`[BulkSend] Limit     : ${limit}`);

  // 1. fetchLeads
  const leads = await fetchLeads({
    sportKey,
    unMessaged: onlyUnMessaged,
    limit,
  });

  if (leads.length === 0) {
    logger.info("[BulkSend] No eligible leads found — nothing to send.");
    return { sent: 0, failed: 0, skipped: 0 };
  }

  return await sendBatch(leads, template, dryRun);
}

// ── Core: send batch ──────────────────────────────────────────
async function sendBatch(leads, template, dryRun) {
  logger.info(`[BulkSend] Sending to ${leads.length} lead(s)...`);

  const results = { sent: 0, failed: 0, skipped: 0 };
  let successIds = [];
  let logs = [];
  let lastFlushTime = Date.now();

  for (const lead of leads) {
    const phone = lead.phone;

    if (!phone) {
      logger.warn(`[BulkSend] Lead ${lead.id} has no phone — skipping`);
      results.skipped++;
      continue;
    }

    if (dryRun) {
      logger.info(`[BulkSend] [DRY RUN] Would send to ${phone} (${lead.name})`);
      results.sent++;
      continue;
    }

    // 3. Send
    const result = await sendTemplateMessage(phone, template, lead);

    if (result.success) {
      logger.info(`[BulkSend] ✅ Sent to ${phone} (${lead.name}) — msgId: ${result.messageId}`);
      successIds.push(lead.id);
      results.sent++;
    } else {
      logger.error(`[BulkSend] ❌ Failed for ${phone} (${lead.name}): ${result.error}`);
      results.failed++;
    }

    logs.push({
      lead_id:       lead.id,
      phone:         lead.phone,
      template_name: template.name,
      status:        result.success ? "sent" : "failed",
      wa_message_id: result.messageId || null,
      error_message: result.error    || null,
    });

    // 4. Batch DB writes (flush every 50 or 3 seconds)
    const timeSinceFlush = Date.now() - lastFlushTime;
    if (logs.length >= 50 || timeSinceFlush >= 3000) {
      await persistBatch(successIds, logs);
      successIds = [];
      logs = [];
      lastFlushTime = Date.now();
    }

    // 5. Global Rate limiting delay
    await delay(GLOBAL_SEND_DELAY);
  }

  // Final flush
  if (logs.length > 0) {
    await persistBatch(successIds, logs);
  }

  // Summary
  logger.info(
    `[BulkSend] Done. Sent: ${results.sent} | Failed: ${results.failed} | Skipped: ${results.skipped}`
  );
  return results;
}

// ── CLI support ───────────────────────────────────────────────
// Run directly: node bulkSender.js [--sport <key>] [--template <key>] [--dry-run] [--limit <n>]
if (require.main === module) {
  const args     = process.argv.slice(2);
  const getArg   = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
  const hasFlag  = (flag) => args.includes(flag);

  runBulkSend({
    sportKey:        getArg("--sport")    || null,
    templateKey:     getArg("--template") || "general_followup",
    dryRun:          hasFlag("--dry-run"),
    limit:           parseInt(getArg("--limit") || "100", 10),
    onlyUnMessaged:  !hasFlag("--all"),   // pass --all to ignore the 7-day cooldown
  })
    .then(() => process.exit(0))
    .catch((err) => { logger.error("[BulkSend] Fatal:", err.message); process.exit(1); });
}

module.exports = { runBulkSend, sendTemplateMessage, TEMPLATES };
