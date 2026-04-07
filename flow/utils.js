/**
 * utils.js — Pure helper functions for the PSV bot flow.
 *
 * All functions are stateless and side-effect free.
 * Migrated and generalised from the inline logic in bot.js.
 */

const sports = require("../data/sports");

// ─────────────────────────────────────────────
// Sport config helpers
// ─────────────────────────────────────────────

/** Full sport config for a top-level key (e.g. "badminton") */
function getSportData(key) {
  return sports[key] || null;
}

/**
 * Builds the WhatsApp list rows array for the sport selection menu.
 * Returns both the rows (for sendListMessage) and a menuMap ({ "1": "badminton", ... }).
 */
function buildSportMenuRows() {
  const keys = Object.keys(sports);
  const menuMap = {};
  const rows = keys.map((key, i) => {
    menuMap[String(i + 1)] = key;
    const sport = sports[key];
    return {
      id:          key,                   // used by interactive list replies
      title:       sport.name,
      description: sport.description || "",
    };
  });
  return { rows, menuMap };
}

/**
 * Builds WhatsApp button objects for a sport's sub-options.
 * Returns buttons (for sendButtonMessage) and a subMenuMap.
 */
function buildSubOptionButtons(sportKey) {
  const sport = getSportData(sportKey);
  if (!sport?.hasSubOptions) return null;

  const keys = Object.keys(sport.options);
  const subMenuMap = {};
  const buttons = keys.map((key, i) => {
    subMenuMap[String(i + 1)] = key;
    return {
      id:    key,                         // used by interactive button replies
      title: sport.options[key].title,
    };
  });
  return { buttons, subMenuMap };
}

/**
 * Resolves the final tabName and info message from session state.
 * Works for both direct sports and sub-option sports.
 */
function resolveLeadMeta(sportKey) {
  const sport = getSportData(sportKey);
  if (!sport) return { tabName: sportKey, message: "Thank you for your interest!" };

  // sportKey might be a top-level key (e.g. "archery")
  // or a sub-option key (e.g. "badminton_coaching") — handle both

  // Check if it's a direct sport
  if (!sport.hasSubOptions) {
    return { tabName: sport.tabName, message: sport.message };
  }

  // It's a top-level key with sub-options — shouldn't reach here normally
  // but handle gracefully
  return { tabName: sport.name, message: "" };
}

/**
 * Resolves tab name + message for a sub-option key like "badminton_coaching".
 * Searches all sports' options maps.
 */
function resolveSubOptionMeta(optionKey) {
  for (const sport of Object.values(sports)) {
    if (sport.hasSubOptions && sport.options?.[optionKey]) {
      const opt = sport.options[optionKey];
      return { tabName: opt.tabName, message: opt.message };
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// Message parsing helpers
// ─────────────────────────────────────────────

/**
 * Extracts the ID from an interactive message (list or button reply).
 * Returns null for plain text messages.
 */
function extractInteractiveId(message) {
  if (message.type !== "interactive") return null;
  return (
    message.interactive?.list_reply?.id ||
    message.interactive?.button_reply?.id ||
    null
  );
}

/** Returns trimmed text body, or empty string. */
function extractText(message) {
  return (message?.text?.body || "").trim();
}

/**
 * Resolves what sport/option the user chose.
 * Handles both interactive replies (id) and fallback text matching.
 * Returns the sport/option key string, or null if unrecognised.
 */
function resolveSportKey(message, menuMap) {
  // Interactive list reply — id is the sport key directly
  const id = extractInteractiveId(message);
  if (id && sports[id]) return id;

  // Number-based reply (e.g. user typed "1")
  const text = extractText(message);
  if (menuMap?.[text]) return menuMap[text];

  // Fallback: fuzzy text match (kept from original bot.js)
  const lower = text.toLowerCase();
  if (lower.includes("badminton"))                        return "badminton";
  if (lower.includes("archery"))                          return "archery";
  if (lower.includes("basket"))                           return "basketball";
  if (lower.includes("skate") || lower.includes("roller")) return "roller_skating";

  return null;
}

/**
 * Resolves sub-option key from button reply or text.
 * Returns the option key string, or null.
 */
function resolveSubOptionKey(message, subMenuMap) {
  const id = extractInteractiveId(message);
  if (id) return id; // button reply id is the option key directly

  const text = extractText(message);
  if (subMenuMap?.[text]) return subMenuMap[text];

  // Fuzzy fallback for badminton (kept from original)
  const lower = text.toLowerCase();
  if (lower.includes("coach"))                            return "badminton_coaching";
  if (lower.includes("court") || lower.includes("book")) return "badminton_court";

  return null;
}

/**
 * Returns true if the message should trigger a full flow restart.
 */
function isRestartTrigger(text) {
  return ["menu", "hi", "hello", "start", "restart", "back"].includes(
    text.toLowerCase()
  );
}

/**
 * Returns true if the user wants to skip location.
 */
function isSkipLocation(message) {
  const id   = extractInteractiveId(message);
  if (id === "skip_location") return true;
  const text = extractText(message).toLowerCase();
  return ["skip", "no", "nope", "none", "-"].includes(text);
}

/**
 * Returns true if the user clicked "share_location" button.
 */
function isShareLocationButton(message) {
  return extractInteractiveId(message) === "share_location";
}

/** Validates a name input — at least 2 chars, contains a letter. */
function isValidName(text) {
  return text.length >= 2 && /[a-zA-Z]/.test(text);
}

module.exports = {
  getSportData,
  buildSportMenuRows,
  buildSubOptionButtons,
  resolveLeadMeta,
  resolveSubOptionMeta,
  extractInteractiveId,
  extractText,
  resolveSportKey,
  resolveSubOptionKey,
  isRestartTrigger,
  isSkipLocation,
  isShareLocationButton,
  isValidName,
};
