/// <reference lib="deno.ns" />

import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

import {
  isImmediateExternalRetryState,
  processExternalDeletionSteps,
  type ExternalDeletionState,
} from './processor.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const JSON_HEADERS = { 'Content-Type': 'application/json' };

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY || !RESEND_API_KEY) {
  throw new Error('Missing required account-deletion retry processor configuration.');
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function sendCompletionEmail(userId: string, email: string): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Idempotency-Key': `account-deletion-${userId}`,
    },
    body: JSON.stringify({
      from: 'HockeyLife <noreply@hockeylife.com>',
      to: email,
      subject: 'Your account deletion is complete',
      html: '<p>Your sign-in and active account data were deleted. Historical hockey facts and legally required payment and signed-waiver records are retained as described in our privacy notice.</p>',
    }),
  });
  if (!response.ok) throw new Error('Completion email failed.');
}

Deno.serve(async (request) => {
  const authHeader = request.headers.get('Authorization');
  const cronSecret = request.headers.get('X-Cron-Secret');
  const configuredCronSecret = Deno.env.get('CRON_SECRET');
  const authorized = (Boolean(configuredCronSecret) && cronSecret === configuredCronSecret)
    || authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
  if (!authorized) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: JSON_HEADERS,
    });
  }

  const results = { processed: 0, completed: 0, failed: 0, retryMarkerFailures: 0 };
  const { data: externalRows, error: externalError } = await supabase
    .from('account_deletion_state')
    .select('user_id,database_deleted_at,stripe_customer_id,stripe_completed_at,completion_email,email_completed_at,completed_at,initiation_kind,workflow_state')
    .eq('initiation_kind', 'immediate')
    .eq('workflow_state', 'database_deleted')
    .not('database_deleted_at', 'is', null)
    .is('completed_at', null)
    .limit(50);
  if (externalError) {
    return new Response(JSON.stringify({ error: 'Unable to load external deletion retry work.', results }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }

  for (const state of (externalRows ?? []) as ExternalDeletionState[]) {
    results.processed += 1;
    if (!isImmediateExternalRetryState(state)) {
      results.failed += 1;
      continue;
    }
    try {
      await processExternalDeletionSteps(state, {
        deleteStripeCustomer: async (customerId) => {
          try {
            await stripe.customers.del(customerId);
          } catch (error) {
            if ((error as { code?: string }).code !== 'resource_missing') throw error;
          }
        },
        sendCompletionEmail: (email) => sendCompletionEmail(state.user_id, email),
        recordStep: async (step) => {
          const { data, error } = await supabase.rpc('record_account_deletion_external_step', {
            p_user_id: state.user_id,
            p_step: step,
          });
          if (error || data !== true) {
            throw new Error(`Unable to record ${step} deletion step.`);
          }
        },
      });
      results.completed += 1;
    } catch {
      results.failed += 1;
      const { data, error } = await supabase.rpc('record_account_deletion_retry_error', {
        p_user_id: state.user_id,
      });
      if (error || data !== true) {
        results.retryMarkerFailures += 1;
      }
    }
  }

  return new Response(JSON.stringify({
    message: results.failed === 0
      ? 'Immediate account-deletion retries processed.'
      : 'One or more immediate account-deletion retries failed.',
    results,
  }), {
    status: results.failed === 0 ? 200 : 500,
    headers: JSON_HEADERS,
  });
});
