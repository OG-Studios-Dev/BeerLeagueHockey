/**
 * Compatibility-only server actions for the retired delayed-deletion workflow.
 *
 * v1 supports immediate deletion from the authenticated Hockey Life mobile
 * app. These exports remain so stale clients fail closed with explicit
 * guidance; they intentionally perform no authentication, database, email, or
 * session mutation.
 */

'use server';

export const ACCOUNT_DELETION_V1_UNAVAILABLE =
  'Scheduled account deletion is unavailable in v1. Use Delete Account in the Hockey Life mobile app for immediate deletion, or contact privacy support.';

export type DeletionStatus = 'pending' | 'cancelled' | 'processing' | 'completed' | 'failed';

export interface AccountDeletionRequest {
  id: string;
  user_id: string;
  profile_email: string;
  requested_at: string;
  scheduled_for: string;
  cancelled_at: string | null;
  completed_at: string | null;
  deletion_reason: string | null;
  status: DeletionStatus;
  initial_notification_sent: boolean;
  reminder_7day_sent: boolean;
  completion_notification_sent: boolean;
}

type UnavailableResult = {
  success: false;
  code: 'scheduled_deletion_unavailable_v1';
  error: string;
};

function unavailable(): UnavailableResult {
  return {
    success: false,
    code: 'scheduled_deletion_unavailable_v1',
    error: ACCOUNT_DELETION_V1_UNAVAILABLE,
  };
}

export async function requestAccountDeletion(_reason?: string): Promise<UnavailableResult> {
  return unavailable();
}

export async function cancelAccountDeletion(): Promise<UnavailableResult> {
  return unavailable();
}

export async function getAccountDeletionStatus(): Promise<{
  available: false;
  hasPendingDeletion: false;
  code: 'scheduled_deletion_unavailable_v1';
  guidance: string;
}> {
  return {
    available: false,
    hasPendingDeletion: false,
    code: 'scheduled_deletion_unavailable_v1',
    guidance: ACCOUNT_DELETION_V1_UNAVAILABLE,
  };
}

export async function getAllDeletionRequests(
  _status?: DeletionStatus,
): Promise<UnavailableResult & { requests: [] }> {
  return { ...unavailable(), requests: [] };
}
