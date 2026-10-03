import { describe, expect, it } from '@jest/globals';
import {
  buildDefaultLineupLayout,
  normalizeLineupLayout,
  type LineupRosterPlayer,
} from '../types';

function player(overrides: Partial<LineupRosterPlayer>): LineupRosterPlayer {
  return {
    playerId: overrides.playerId ?? `player-${Math.random()}`,
    fullName: overrides.fullName ?? 'Player',
    avatarUrl: overrides.avatarUrl ?? null,
    jerseyNumber: overrides.jerseyNumber ?? null,
    position: overrides.position ?? null,
    availability: overrides.availability ?? 'confirmed',
  };
}

describe('lineup layout helpers', () => {
  it('builds a seeded lineup from the active RSVP roster', () => {
    const roster = [
      player({ playerId: 'g1', fullName: 'Goalie', jerseyNumber: 1, position: 'G' }),
      player({ playerId: 'c1', fullName: 'Center', jerseyNumber: 19, position: 'C' }),
      player({ playerId: 'lw1', fullName: 'Left Wing', jerseyNumber: 12, position: 'LW' }),
      player({ playerId: 'rw1', fullName: 'Right Wing', jerseyNumber: 91, position: 'RW' }),
      player({ playerId: 'ld1', fullName: 'Left D', jerseyNumber: 4, position: 'LD' }),
      player({ playerId: 'rd1', fullName: 'Right D', jerseyNumber: 5, position: 'RD' }),
      player({ playerId: 'out1', fullName: 'Unavailable', jerseyNumber: 30, position: 'F', availability: 'out' }),
    ];

    const layout = buildDefaultLineupLayout(roster);
    const placedIds = layout.placedPlayers.map((entry) => entry.playerId);

    expect(layout.roster).toHaveLength(7);
    expect(layout.roster.map((entry) => entry.playerId)).toContain('out1');
    expect(placedIds).toEqual(expect.arrayContaining(['g1', 'c1', 'lw1', 'rw1', 'ld1', 'rd1']));
    expect(layout.placedPlayers.find((entry) => entry.playerId === 'g1')).toEqual(
      expect.objectContaining({ x: 50, y: 86 })
    );
  });

  it('normalizes saved layouts against the current roster', () => {
    const roster = [
      player({ playerId: 'c1', fullName: 'Center', jerseyNumber: 19, position: 'C' }),
      player({ playerId: 'w1', fullName: 'Wing', jerseyNumber: 12, position: 'LW' }),
    ];

    const layout = normalizeLineupLayout(
      {
        placedPlayers: [
          { playerId: 'c1', x: 2, y: 150 },
          { playerId: 'c1', x: 44, y: 55 },
          { playerId: 'ghost', x: 50, y: 50 },
        ],
      },
      roster
    );

    expect(layout.placedPlayers).toEqual([
      { playerId: 'c1', x: 8, y: 92 },
    ]);
    expect(layout.roster.map((entry) => entry.playerId)).toEqual(['w1', 'c1']);
  });
});
