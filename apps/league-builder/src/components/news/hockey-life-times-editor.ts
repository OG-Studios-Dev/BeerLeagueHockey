import type { NewspaperNarrativePatch } from '@/lib/hockey-life-times/domain';

export interface HockeyLifeTimesEditorState {
  lead: { headline: string; dek: string; body: string };
  games: Array<{ gameId: string; headline: string; body: string }>;
}

interface EditableEditionNarrative {
  lead: { headline: string; dek: string; body: string[] };
  games: Array<{ gameId: string; headline: string; body: string[] }>;
}

export function editorStateFromEdition(edition: EditableEditionNarrative): HockeyLifeTimesEditorState {
  return {
    lead: { ...edition.lead, body: edition.lead.body.join('\n\n') },
    games: edition.games.map((game) => ({ ...game, body: game.body.join('\n\n') })),
  };
}

export function updateLeadBodyDraft(
  state: HockeyLifeTimesEditorState,
  body: string,
): HockeyLifeTimesEditorState {
  return { ...state, lead: { ...state.lead, body } };
}

function splitParagraphsOnSave(value: string): string[] {
  return value.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

export function narrativePatchFromEditorState(state: HockeyLifeTimesEditorState): NewspaperNarrativePatch {
  return {
    lead: { ...state.lead, body: splitParagraphsOnSave(state.lead.body) },
    games: state.games.map((game) => ({ ...game, body: splitParagraphsOnSave(game.body) })),
  };
}
