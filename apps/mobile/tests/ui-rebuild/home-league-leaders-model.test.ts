import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { HomeLeader } from '../../src/lib/supabase/home';
import {
  JACK_FOOTE_ART_IDENTITY,
  rankHomeLeaders,
  resolveLeaderArtwork,
} from '../../src/lib/homeLeagueLeaders';

const leagueId = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';

function leader(overrides: Partial<HomeLeader> & Pick<HomeLeader, 'player_id' | 'player_name'>): HomeLeader {
  return {
    avatar_url: null,
    team_id: null,
    team_name: 'Free agent',
    display_team_name: null,
    display_team_logo_url: null,
    position: null,
    goals: 0,
    assists: 0,
    points: 0,
    ...overrides,
  };
}

describe('Home League Leaders ranking model', () => {
  it('ranks the full eligible population before limiting to three without mutating input', () => {
    const input = [
      leader({ player_id: 'd', player_name: 'Same', team_id: 'team-b', points: 2 }),
      leader({ player_id: 'b', player_name: 'Bravo', points: 3 }),
      leader({ player_id: 'a', player_name: 'Alpha', points: 3 }),
      leader({ player_id: 'c', player_name: 'Same', team_id: 'team-a', points: 2 }),
      leader({ player_id: 'zero', player_name: 'Zero', points: 0 }),
      leader({ player_id: 'nan', player_name: 'NaN', points: Number.NaN }),
    ];
    const original = [...input];

    const ranked = rankHomeLeaders(input, 'points');

    assert.deepEqual(ranked.map((row) => [row.player_id, row.rankLabel]), [
      ['a', 'T1'], ['b', 'T1'], ['c', 'T3'],
    ]);
    assert.deepEqual(input, original);
  });

  it('supports empty and fewer-than-three results without fake padding', () => {
    assert.deepEqual(rankHomeLeaders([], 'goals'), []);
    assert.deepEqual(
      rankHomeLeaders([leader({ player_id: 'one', player_name: 'One', goals: 1 })], 'goals')
        .map((row) => [row.player_id, row.rankLabel]),
      [['one', '1']],
    );
  });

  it('matches the captured 2026-10-04 public Home leaders for every tab', () => {
    const captured = JSON.parse(readFileSync(new URL('./fixtures/public-home-leaders-2026-10-04.json', import.meta.url).pathname, 'utf8')) as HomeLeader[];
    assert.deepEqual(rankHomeLeaders(captured, 'points').map((row) => [row.player_name, row.metricValue, row.rankLabel]), [
      ['Jack Foote', 3, 'T1'], ['Trevor Paterson', 3, 'T1'], ['Adrian Hartley', 2, 'T3'],
    ]);
    assert.deepEqual(rankHomeLeaders(captured, 'goals').map((row) => row.player_name), ['Jack Foote', 'Trevor Paterson', 'Adrian Hartley']);
    assert.equal(rankHomeLeaders(captured, 'assists')[0]?.player_name, 'Kyle Geraghty');
  });
});

describe('Home League Leaders artwork policy', () => {
  it('accepts generated Jack art only for the exact league, player and avatar version', () => {
    const jack = leader({
      player_id: JACK_FOOTE_ART_IDENTITY.playerId,
      player_name: 'Jack Foote',
      avatar_url: JACK_FOOTE_ART_IDENTITY.avatarUrl,
    });
    assert.equal(resolveLeaderArtwork(leagueId, jack).kind, 'generated');
    assert.equal(resolveLeaderArtwork('wrong-league', jack).kind, 'photo');
    assert.equal(resolveLeaderArtwork(leagueId, { ...jack, player_id: 'wrong-player' }).kind, 'photo');
    assert.equal(resolveLeaderArtwork(leagueId, { ...jack, avatar_url: `${jack.avatar_url}?changed=1` }).kind, 'photo');
  });

  it('uses a genuine photo for unmatched photographed leaders and neutral art when no photo exists', () => {
    const photo = leader({ player_id: 'photo', player_name: 'Photo Player', avatar_url: 'https://example.test/photo.png' });
    const missing = leader({ player_id: 'missing', player_name: 'Missing Player' });
    assert.deepEqual(resolveLeaderArtwork(leagueId, photo), {
      kind: 'photo',
      identityKey: `${leagueId}:photo:https://example.test/photo.png:photo`,
      uri: 'https://example.test/photo.png',
      accessibilityLabel: 'Photo Player player photo',
    });
    assert.equal(resolveLeaderArtwork(leagueId, missing).kind, 'neutral');
    assert.match(resolveLeaderArtwork(leagueId, missing).accessibilityLabel, /no player photo available/i);
  });
});
