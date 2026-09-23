/// <reference lib="deno.ns" />

import { createClient } from 'jsr:@supabase/supabase-js@2';

import { createAppleAuthorizationService } from './apple.ts';
import { createDeleteAccountHandler } from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const APPLE_TEAM_ID = Deno.env.get('APPLE_TEAM_ID');
const APPLE_KEY_ID = Deno.env.get('APPLE_KEY_ID');
const APPLE_CLIENT_ID = Deno.env.get('APPLE_CLIENT_ID');
const APPLE_PRIVATE_KEY_P8 = Deno.env.get('APPLE_PRIVATE_KEY_P8');

if (
  !SUPABASE_URL
  || !SUPABASE_SERVICE_ROLE_KEY
  || !APPLE_TEAM_ID
  || !APPLE_KEY_ID
  || !APPLE_CLIENT_ID
  || !APPLE_PRIVATE_KEY_P8
) {
  throw new Error('Missing required account-deletion server configuration.');
}

const appleAuthorization = createAppleAuthorizationService({
  teamId: APPLE_TEAM_ID,
  keyId: APPLE_KEY_ID,
  clientId: APPLE_CLIENT_ID,
  privateKeyP8: APPLE_PRIVATE_KEY_P8,
});

const deleteAccountHandler = createDeleteAccountHandler(() =>
  createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }),
  { appleAuthorization },
);

Deno.serve(deleteAccountHandler);
