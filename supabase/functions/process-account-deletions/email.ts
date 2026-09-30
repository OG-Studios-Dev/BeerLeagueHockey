export const DEFAULT_RESEND_FROM_EMAIL = 'HockeyLife <noreply@beerleaguehockey.ca>';

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function sendAccountDeletionCompletionEmail(
  configuration: {
    apiKey: string;
    fromEmail?: string;
    fetchImpl?: FetchLike;
  },
  userId: string,
  email: string,
): Promise<void> {
  const response = await (configuration.fetchImpl ?? fetch)('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${configuration.apiKey}`,
      'Idempotency-Key': `account-deletion-${userId}`,
    },
    body: JSON.stringify({
      from: configuration.fromEmail?.trim() || DEFAULT_RESEND_FROM_EMAIL,
      to: email,
      subject: 'Your account deletion is complete',
      html: '<p>Your sign-in and active account data were deleted. Historical hockey facts and legally required payment and signed-waiver records are retained as described in our privacy notice.</p>',
    }),
  });
  if (!response.ok) throw new Error('Completion email failed.');
}
