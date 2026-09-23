export type ExternalDeletionState = {
  user_id: string;
  database_deleted_at: string | null;
  stripe_customer_id: string | null;
  stripe_completed_at: string | null;
  completion_email: string | null;
  email_completed_at: string | null;
  completed_at: string | null;
};

export type ExternalDeletionDependencies = {
  deleteStripeCustomer: (customerId: string) => Promise<void>;
  sendCompletionEmail: (email: string) => Promise<void>;
  recordStep: (step: 'stripe' | 'email' | 'complete') => Promise<void>;
};

export type ReminderClaim = {
  id: string;
  user_id: string;
  profile_email: string;
  scheduled_for: string;
};

export type ReminderDependencies = {
  sendReminderEmail: (
    email: string,
    scheduledFor: string,
    idempotencyKey: string,
  ) => Promise<void>;
  markReminderSent: (id: string) => Promise<void>;
  releaseReminderClaim: (id: string) => Promise<void>;
};

export function reminderIdempotencyKey(claim: Pick<ReminderClaim, 'id' | 'user_id'>): string {
  return `account-deletion-reminder-${claim.user_id}-${claim.id}`;
}

export async function processReminderClaim(
  claim: ReminderClaim,
  dependencies: ReminderDependencies,
): Promise<void> {
  try {
    await dependencies.sendReminderEmail(
      claim.profile_email,
      claim.scheduled_for,
      reminderIdempotencyKey(claim),
    );
  } catch (error) {
    await dependencies.releaseReminderClaim(claim.id);
    throw error;
  }

  // If this write fails, retain the claim until its lease expires. The next
  // worker retries with the same provider idempotency key, so a provider
  // success followed by a database failure cannot duplicate the email.
  await dependencies.markReminderSent(claim.id);
}

export async function processExternalDeletionSteps(
  state: ExternalDeletionState,
  dependencies: ExternalDeletionDependencies,
): Promise<void> {
  if (!state.database_deleted_at) throw new Error('Database deletion is not complete.');
  if (state.completed_at) return;

  if (!state.stripe_completed_at) {
    if (state.stripe_customer_id) {
      await dependencies.deleteStripeCustomer(state.stripe_customer_id);
    }
    await dependencies.recordStep('stripe');
    state.stripe_completed_at = state.stripe_completed_at ?? new Date().toISOString();
    state.stripe_customer_id = null;
  }

  if (!state.email_completed_at) {
    if (!state.completion_email) throw new Error('Completion email retry payload is missing.');
    await dependencies.sendCompletionEmail(state.completion_email);
    await dependencies.recordStep('email');
    state.email_completed_at = state.email_completed_at ?? new Date().toISOString();
    state.completion_email = null;
  }

  await dependencies.recordStep('complete');
  state.completed_at = state.completed_at ?? new Date().toISOString();
}
