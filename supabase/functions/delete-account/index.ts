/// <reference lib="deno.ns" />

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { createDeleteAccountHandler } from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing required Supabase server configuration.');
}

const deleteAccountHandler = createDeleteAccountHandler(() =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
);

Deno.serve(deleteAccountHandler);
