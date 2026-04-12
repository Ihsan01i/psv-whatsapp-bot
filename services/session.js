/**
 * session.js — In-memory session store with automatic TTL expiry.
 *
 * Replaces the old sessions.json file-based approach.
 * Sessions expire after 30 minutes of inactivity and are
 * auto-purged every 10 minutes to prevent memory leaks.
 *
 * Session shape:
 * {
 *   step:       "new" | "awaiting_sport" | "awaiting_sub_option" |
 *               "awaiting_name" | "awaiting_location" | "typing_location" | "completed"
 *   waName:     string   — WhatsApp profile display name
 *   phone:      string   — User's phone number
 *   sportKey:   string   — e.g. "badminton_coaching", "archery"
 *   name:       string   — Collected user name
 *   location:   string   — Collected location (optional)
 *   menuMap:    object   — { "1": "badminton", "2": "archery", ... }
 *   subMenuMap: object   — { "1": "badminton_coaching", "2": "badminton_court" }
 *   updatedAt:  number   — Timestamp for TTL tracking
 * }
 */

const logger = require("../utils/logger");

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

const store = {};

/**
 * Get an existing session or create a fresh one.
 * Expired sessions are automatically reset.
 */
function getSession(phone) {
  const existing = store[phone];

  if (existing) {
    const age = Date.now() - existing.updatedAt;
    if (age < SESSION_TTL_MS) return existing;
    logger.info(`[Session] Expired session for ${phone} — resetting`);
  }

  return _createSession(phone);
}

/**
 * Merge updates into an existing session (or create one).
 * Always refreshes the TTL timestamp.
 */
function updateSession(phone, updates) {
  const session = store[phone] || _createSession(phone);
  Object.assign(session, updates, { updatedAt: Date.now() });
  logger.debug(`[Session] Updated ${phone} → step: ${session.step}`);
}

/**
 * Hard reset — wipes all session state back to "new".
 * Called when user types "menu", "hi", etc.
 */
function resetSession(phone, waName) {
  store[phone] = {
    step: "new",
    waName: waName || "",
    phone,
    sportKey: null,
    name: null,
    location: null,
    menuMap: null,
    subMenuMap: null,
    updatedAt: Date.now(),
  };
  logger.info(`[Session] Reset session for ${phone}`);
  return store[phone];
}

// ── Internal ──────────────────────────────────────────────────

const MAX_SESSIONS = 50000;

function _createSession(phone) {
  const keys = Object.keys(store);
  if (keys.length >= MAX_SESSIONS) {
    let oldestPhone = keys[0];
    let oldestTime = store[oldestPhone].updatedAt;
    for (const k of keys) {
      if (store[k].updatedAt < oldestTime) {
        oldestTime = store[k].updatedAt;
        oldestPhone = k;
      }
    }
    delete store[oldestPhone];
    logger.warn(`[Session] Store full — evicted oldest session: ${oldestPhone}`);
  }

  store[phone] = {
    step: "new",
    waName: "",
    phone,
    sportKey: null,
    name: null,
    location: null,
    menuMap: null,
    subMenuMap: null,
    updatedAt: Date.now(),
  };
  logger.info(`[Session] New session created for ${phone}`);
  return store[phone];
}

// Purge expired sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  let count = 0;
  for (const phone of Object.keys(store)) {
    if (now - store[phone].updatedAt >= SESSION_TTL_MS) {
      delete store[phone];
      count++;
    }
  }
  if (count > 0) logger.info(`[Session] Purged ${count} expired session(s)`);
}, 10 * 60 * 1000);

module.exports = { getSession, updateSession, resetSession };
