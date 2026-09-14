import { validateContactDraft, type ContactDraft } from '../eventsContactModel';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ContactSubmissionRow = {
  league_id: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  is_read: false;
};
export type ContactInsertAdapter = (row: ContactSubmissionRow) => Promise<{ error: { message: string } | null }>;

async function insertWithCurrentClient(row: ContactSubmissionRow) {
  const { supabase } = await import('./client');
  return supabase.from('contact_submissions').insert(row);
}

export async function submitContactSubmission(
  input: { leagueId: string; draft: ContactDraft },
  insert: ContactInsertAdapter = insertWithCurrentClient,
): Promise<{ success: boolean; error: string | null }> {
  if (!UUID.test(input.leagueId)) return { success: false, error: 'Invalid league destination.' };
  if (Object.keys(validateContactDraft(input.draft)).length > 0) return { success: false, error: 'Check the highlighted fields.' };
  const row: ContactSubmissionRow = {
    league_id: input.leagueId,
    name: input.draft.name.trim(),
    email: input.draft.email.trim(),
    subject: input.draft.subject.trim(),
    message: input.draft.message.trim(),
    is_read: false,
  };
  try {
    const { error } = await insert(row);
    return error ? { success: false, error: error.message || 'The message was not accepted.' } : { success: true, error: null };
  } catch (reason) {
    return { success: false, error: reason instanceof Error && reason.message ? reason.message : 'The message was not accepted.' };
  }
}
