// ============================================================
// db.js — Supabase client (singleton)
// Place in: src/services/db.js  (or root /db.js)
//
// Install:  npm install @supabase/supabase-js
// Env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY
// ============================================================

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL         = process.env.SUPABASE_URL;
// Use the service role key to bypass RLS entirely (as per user config)
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error("FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  },
  // Adding the Fetch Interceptor for debugging Node 24/undici
  global: {
    fetch: async (url, options) => {
      const response = await fetch(url, options);
      
      // Log raw response for debugging hidden errors
      console.log(`[Supabase Fetch] ${options.method} ${url} - Status: ${response.status}`);
      
      if (!response.ok) {
        const errorBody = await response.clone().text();
        console.error(`[Supabase Error Body]:`, errorBody);
      }
      
      return response;
    }
  }
});

module.exports = supabase;
