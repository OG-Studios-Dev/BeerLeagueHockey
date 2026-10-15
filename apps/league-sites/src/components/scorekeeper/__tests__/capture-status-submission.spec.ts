import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('@/lib/actions/scorekeeper', () => ({
  getGameSummary: jest.fn(),
  submitGameForVerification: jest.fn(),
  saveScorekeeperNotes: jest.fn(),
}));

import {
  CaptureStatusReview,
  getAttendanceReviewWarnings,
  submitGameSummaryReview,
} from '../GameSummaryModal';

describe('game summary capture-status submission', () => {
  const goalieAppearances = [
    { playerId: 'home-goalie', teamId: 'home-team', teamType: 'home' as const },
    { playerId: 'away-goalie', teamId: 'away-team', teamType: 'away' as const },
  ];
  it('renders accessible required choices without selecting or inferring an answer', () => {
    const markup = renderToStaticMarkup(
      React.createElement(CaptureStatusReview, {
        penaltyChoice: null,
        goalieChoice: null,
        onPenaltyChoiceChange: jest.fn(),
        onGoalieChoiceChange: jest.fn(),
      }),
    );

    expect(markup).toContain('Penalty review');
    expect(markup).toContain('No penalties confirmed');
    expect(markup).toContain('All penalties recorded');
    expect(markup).toContain('Not fully recorded');
    expect(markup).toContain('Goalie review');
    expect(markup).toContain('All saves/shots and goalie assignments recorded');
    expect(markup).toContain('Not tracked/partial');
    expect(markup).toContain('required=""');
    expect(markup).not.toContain('checked=""');
  });

  it('requires explicit appearances for both teams when goalie measurements are complete', async () => {
    const submit = jest.fn();
    const result = await submitGameSummaryReview({
      gameId: 'game-1', notes: '', originalNotes: '', penaltyChoice: 'none_confirmed',
      goalieChoice: 'all_recorded', goalieAppearances: [goalieAppearances[0]],
    }, { saveNotes: jest.fn(), submit });
    expect(result).toEqual({
      success: false,
      error: 'Select every goalie who appeared for both teams before marking goalie capture complete.',
    });
    expect(submit).not.toHaveBeenCalled();
  });

  it('blocks the real submission runner until both reviews are explicit', async () => {
    const saveNotes = jest.fn();
    const submit = jest.fn();

    const result = await submitGameSummaryReview(
      {
        gameId: 'game-1',
        notes: 'kept locally',
        originalNotes: '',
        penaltyChoice: null,
        goalieChoice: 'all_recorded',
      },
      { saveNotes, submit },
    );

    expect(result).toEqual({
      success: false,
      error: 'Choose a penalty review and a goalie review before submitting.',
    });
    expect(saveNotes).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([
    ['none_confirmed', 'all_recorded', { penalties: 'complete', goalies: 'complete', goalieAppearances }],
    ['all_recorded', 'not_tracked_or_partial', { penalties: 'complete', goalies: 'not_recorded', goalieAppearances: [] }],
    ['not_fully_recorded', 'all_recorded', { penalties: 'not_recorded', goalies: 'complete', goalieAppearances }],
  ] as const)(
    'maps %s and %s to the exact submitted capture payload',
    async (penaltyChoice, goalieChoice, expectedCaptureStatus) => {
      const saveNotes = jest.fn().mockResolvedValue({ success: true });
      const submit = jest.fn().mockResolvedValue({
        success: true,
        verificationMode: 'both_captains',
      });

      const result = await submitGameSummaryReview(
        {
          gameId: 'game-1',
          notes: '  retained note  ',
          originalNotes: '',
          penaltyChoice,
          goalieChoice,
          goalieAppearances,
        },
        { saveNotes, submit },
      );

      expect(saveNotes).toHaveBeenCalledWith('game-1', 'retained note');
      expect(submit).toHaveBeenCalledWith('game-1', expectedCaptureStatus);
      expect(result.success).toBe(true);
    },
  );

  it('reports only attendance issues supported by supplied check-ins and events', () => {
    const warnings = getAttendanceReviewWarnings(
      {
        homeTeam: [
          { id: 'out-scorer', fullName: 'Out Scorer', checkinStatus: 'out' },
          { id: 'undecided', fullName: 'Undecided Player', checkinStatus: null },
        ],
        awayTeam: [
          { id: 'confirmed', fullName: 'Confirmed Player', checkinStatus: 'confirmed' },
        ],
      },
      [
        {
          playerId: 'confirmed',
          assist1PlayerId: 'out-scorer',
          assist2PlayerId: null,
          deletedAt: null,
        },
      ],
    );

    expect(warnings).toEqual([
      'Attendance review incomplete: 1 player is still tentative or not marked.',
      'Attendance conflict: Out Scorer is marked OUT but appears in recorded events.',
    ]);
  });
});
