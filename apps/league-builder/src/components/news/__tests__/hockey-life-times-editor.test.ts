import {
  editorStateFromEdition,
  narrativePatchFromEditorState,
  updateLeadBodyDraft,
} from '../hockey-life-times-editor';

describe('Hockey Life Times narrative editor', () => {
  it('preserves sequentially typed spaces, newlines, and blank paragraphs until Save', () => {
    let editor = editorStateFromEdition({
      lead: { headline: 'Headline', dek: 'Dek', body: [] },
      games: [{ gameId: 'game-1', headline: 'Game', body: [] }],
    });
    const typed = 'Hello world\n\nNext paragraph';

    for (const character of typed) {
      editor = updateLeadBodyDraft(editor, editor.lead.body + character);
    }

    expect(editor.lead.body).toBe(typed);
    expect(narrativePatchFromEditorState(editor).lead.body).toEqual([
      'Hello world',
      'Next paragraph',
    ]);
  });
});
