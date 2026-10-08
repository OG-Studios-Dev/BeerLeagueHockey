import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildGamePresentation, normalizeGameStatus, resolveGameAccentColors } from '../../src/lib/gamePresentation.ts';

describe('game presentation model', () => {
  it('presents a postponed game truthfully without score authority', () => {
    assert.deepEqual(normalizeGameStatus('postponed'), {
      label: 'Postponed',
      showScore: false,
      canUseCalendar: false,
      canQuickCheckIn: false,
    });
  });

  it('preserves every authoritative status and default-denies null or unknown values', () => {
    assert.deepEqual(
      ['scheduled', 'in_progress', 'completed', 'pending_verification', 'postponed', 'cancelled', null, 'future_state']
        .map((status) => normalizeGameStatus(status)),
      [
        { label: 'Scheduled', showScore: false, canUseCalendar: true, canQuickCheckIn: true },
        { label: 'Live', showScore: true, canUseCalendar: false, canQuickCheckIn: false },
        { label: 'Final', showScore: true, canUseCalendar: false, canQuickCheckIn: false },
        { label: 'Awaiting Review', showScore: false, canUseCalendar: false, canQuickCheckIn: false },
        { label: 'Postponed', showScore: false, canUseCalendar: false, canQuickCheckIn: false },
        { label: 'Cancelled', showScore: false, canUseCalendar: false, canQuickCheckIn: false },
        { label: 'Status unavailable', showScore: false, canUseCalendar: false, canQuickCheckIn: false },
        { label: 'Status unavailable', showScore: false, canUseCalendar: false, canQuickCheckIn: false },
      ],
    );
  });

  it('builds league-local facts and preserves zero or missing authoritative scores', () => {
    const live = buildGamePresentation({
      scheduled_at: '2026-10-08T02:15:00.000Z',
      location: 'Chick-Fil-A Community Ice Centre — Championship Rink',
      status: 'in_progress',
      away_score: 0,
      home_score: null,
    }, 'America/Toronto');
    assert.deepEqual(live, {
      dateLabel: 'Oct 7',
      timeLabel: '10:15 PM',
      locationLabel: 'Chick-Fil-A Community Ice Centre — Championship Rink',
      statusLabel: 'Live',
      showScore: true,
      awayScoreLabel: '0',
      homeScoreLabel: null,
      canUseCalendar: false,
      canQuickCheckIn: false,
    });

    const pending = buildGamePresentation({
      scheduled_at: 'not-a-date',
      location: '  ',
      status: 'pending_verification',
      away_score: 0,
      home_score: null,
    }, 'Invalid/Timezone');
    assert.deepEqual(pending, {
      dateLabel: null,
      timeLabel: null,
      locationLabel: null,
      statusLabel: 'Awaiting Review',
      showScore: false,
      awayScoreLabel: null,
      homeScoreLabel: null,
      canUseCalendar: false,
      canQuickCheckIn: false,
    });
  });

  it('normalizes safe team accents and uses the league or neutral fallback', () => {
    assert.deepEqual(resolveGameAccentColors('#f60', '#B000FF', '#22d3ee'), { away: '#FF6600', home: '#B000FF' });
    assert.deepEqual(resolveGameAccentColors('orange', null, 'bad'), { away: '#7C8798', home: '#7C8798' });
  });
});
