/**
 * logger.js — Lightweight structured logger with log levels.
 * Swap for winston/pino in production if needed.
 */

const LOG_LEVEL   = process.env.LOG_LEVEL || "info";
const LEVELS      = { debug: 0, info: 1, warn: 2, error: 3 };
const activeLevel = LEVELS[LOG_LEVEL] ?? LEVELS.info;

const ts = () => new Date().toISOString();

const logger = {
  debug: (...a) => LEVELS.debug >= activeLevel && console.debug(`[${ts()}] [DEBUG]`, ...a),
  info:  (...a) => LEVELS.info  >= activeLevel && console.info( `[${ts()}] [INFO] `, ...a),
  warn:  (...a) => LEVELS.warn  >= activeLevel && console.warn( `[${ts()}] [WARN] `, ...a),
  error: (...a) => LEVELS.error >= activeLevel && console.error(`[${ts()}] [ERROR]`, ...a),
};

module.exports = logger;
