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
