const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  console.error('ERROR: Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env file');
  console.error('Please create a Supabase project at https://supabase.com and add your credentials to .env');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: false,
    },
  }
);

module.exports = { supabase };
