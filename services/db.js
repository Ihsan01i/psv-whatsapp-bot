// ============================================================
// db.js — Supabase client (singleton)
// Place in: src/services/db.js  (or root /db.js)
//
// Install:  npm install @supabase/supabase-js
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY; // NEVER the anon key in backend

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error(
    "❌ Missing Supabase env vars. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env"
  );
}

// Use service role key on the backend — bypasses RLS safely
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }, // No browser session needed — server-side only
});

module.exports = supabase;
