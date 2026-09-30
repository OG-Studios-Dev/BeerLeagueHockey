/// <reference lib="deno.ns" />

import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

import { sendAccountDeletionCompletionEmail } from './email.ts';
import {
  createProcessAccountDeletionsHandler,
  type DeletionSelection,
} from './handler.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY || !RESEND_API_KEY) {
  throw new Error('Missing required account-deletion retry processor configuration.');
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function sendCompletionEmail(userId: string, email: string): Promise<void> {
  await sendAccountDeletionCompletionEmail({
    apiKey: RESEND_API_KEY,
    fromEmail: RESEND_FROM_EMAIL,
  }, userId, email);
}

async function loadEligibleStates(selection: DeletionSelection) {
  let query = supabase
    .from('account_deletion_state')
    .select('user_id,database_deleted_at,stripe_customer_id,stripe_completed_at,completion_email,email_completed_at,completed_at,initiation_kind,workflow_state')
    .eq('initiation_kind', 'immediate')
    .eq('workflow_state', 'database_deleted')
    .not('database_deleted_at', 'is', null)
    .is('completed_at', null);
  if (selection.mode === 'target') {
    query = query.eq('user_id', selection.userId);
  }
  return await query.limit(selection.limit);
}

const processAccountDeletionsHandler = createProcessAccountDeletionsHandler({
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY,
  cronSecret: Deno.env.get('ACCOUNT_DELETION_CRON_SECRET') ?? Deno.env.get('CRON_SECRET'),
  loadEligibleStates,
  deleteStripeCustomer: async (customerId) => {
    try {
      await stripe.customers.del(customerId);
    } catch (error) {
      if ((error as { code?: string }).code !== 'resource_missing') throw error;
    }
  },
  sendCompletionEmail,
  recordStep: async (userId, step) => {
    const { data, error } = await supabase.rpc('record_account_deletion_external_step', {
      p_user_id: userId,
      p_step: step,
    });
    if (error || data !== true) {
      throw new Error(`Unable to record ${step} deletion step.`);
    }
  },
  recordRetryError: async (userId) => {
    const { data, error } = await supabase.rpc('record_account_deletion_retry_error', {
      p_user_id: userId,
    });
    return !error && data === true;
  },
});

Deno.serve(processAccountDeletionsHandler);
