/// <reference lib="deno.ns" />

import { createClient } from 'jsr:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';

import { listOwnedProfileImageObjects } from '../delete-account/handler.ts';
import { processExternalDeletionSteps, type ExternalDeletionState } from './processor.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY || !RESEND_API_KEY) {
  throw new Error('Missing required account-deletion processor configuration.');
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-11-20.acacia' });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function isMissingStorageObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; statusCode?: unknown };
  return String(candidate.status ?? candidate.statusCode ?? '') === '404';
}

async function removeOwnedStorage(userId: string): Promise<void> {
  const objects = await listOwnedProfileImageObjects(userId, supabase.storage);
  for (const object of objects) {
    const { error } = await supabase.storage.from(object.bucket).remove([object.path]);
    if (error && !isMissingStorageObject(error)) throw new Error('Storage cleanup failed.');
  }
  const { error } = await supabase.rpc('mark_account_storage_deleted', { p_user_id: userId });
  if (error) throw new Error('Storage cleanup marker failed.');
}

async function sendCompletionEmail(userId: string, email: string): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
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

async function sendReminderEmail(email: string, scheduledFor: string): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'HockeyLife <noreply@hockeylife.com>',
      to: email,
      subject: 'Reminder: your account deletion is scheduled',
      html: `<p>Your account is scheduled for deletion on ${new Date(scheduledFor).toLocaleDateString('en-US')}.</p>`,
    }),
  });
  if (!response.ok) throw new Error('Reminder email failed.');
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
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const results = { processed: 0, completed: 0, failed: 0 };
  const now = new Date().toISOString();
  const { data: dueRows, error: dueError } = await supabase
    .from('account_deletion_log')
    .select('id,user_id')
    .in('status', ['pending', 'processing', 'failed'])
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(50);
  if (dueError) {
    return new Response(JSON.stringify({ error: 'Unable to load deletion work.' }), { status: 500 });
  }

  for (const deletion of dueRows ?? []) {
    results.processed += 1;
    try {
      await supabase.from('account_deletion_log').update({ status: 'processing', error_message: null }).eq('id', deletion.id);
      const { data: durableState, error: durableStateError } = await supabase
        .from('account_deletion_state')
        .select('database_deleted_at')
        .eq('user_id', deletion.user_id)
        .maybeSingle();
      if (durableStateError) throw new Error('Unable to read deletion state.');

      if (!durableState?.database_deleted_at) {
        const { data: preparation, error: prepareError } = await supabase.rpc('prepare_account_deletion', {
          p_user_id: deletion.user_id,
        });
        if (prepareError) throw new Error('Deletion preflight failed.');
        const prepared = preparation as { apple_required?: boolean; apple_revoked?: boolean } | null;
        if (prepared?.apple_required && !prepared.apple_revoked) {
          throw new Error('Apple reauthentication is required before scheduled deletion can continue.');
        }
        await removeOwnedStorage(deletion.user_id);
        const { error: databaseError } = await supabase.rpc('execute_account_deletion', {
          p_user_id: deletion.user_id,
        });
        if (databaseError) throw new Error('Database deletion failed.');
      }
    } catch (error) {
      results.failed += 1;
      await supabase.from('account_deletion_log').update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : 'Deletion failed.',
      }).eq('id', deletion.id);
    }
  }

  const { data: externalRows, error: externalError } = await supabase
    .from('account_deletion_state')
    .select('user_id,database_deleted_at,stripe_customer_id,stripe_completed_at,completion_email,email_completed_at,completed_at')
    .not('database_deleted_at', 'is', null)
    .is('completed_at', null)
    .limit(50);
  if (externalError) {
    return new Response(JSON.stringify({ error: 'Unable to load external deletion work.', results }), { status: 500 });
  }

  for (const state of (externalRows ?? []) as ExternalDeletionState[]) {
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
          const { error } = await supabase.rpc('record_account_deletion_external_step', {
            p_user_id: state.user_id,
            p_step: step,
          });
          if (error) throw new Error(`Unable to record ${step} deletion step.`);
        },
      });
      results.completed += 1;
    } catch (error) {
      results.failed += 1;
      await supabase.from('account_deletion_state').update({
        last_error: error instanceof Error ? error.message : 'External deletion step failed.',
        updated_at: new Date().toISOString(),
      }).eq('user_id', state.user_id);
    }
  }

  const reminderCutoff = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: reminders } = await supabase
    .from('account_deletion_log')
    .select('id,profile_email,scheduled_for')
    .eq('status', 'pending')
    .eq('reminder_7day_sent', false)
    .gte('scheduled_for', now)
    .lte('scheduled_for', reminderCutoff);
  for (const reminder of reminders ?? []) {
    try {
      await sendReminderEmail(reminder.profile_email, reminder.scheduled_for);
      await supabase.from('account_deletion_log').update({ reminder_7day_sent: true }).eq('id', reminder.id);
    } catch {
      // A future invocation retries while the flag remains false.
    }
  }

  return new Response(JSON.stringify({ message: 'Account deletion work processed.', results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
