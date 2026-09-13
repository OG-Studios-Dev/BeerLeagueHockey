import { resolveGoalieInNetSelection } from '../ui-reliability';

const opposingRoster = [
  { id: 'goalie-a', position: 'Goalie' },
  { id: 'goalie-b', position: 'G' },
  { id: 'skater-a', position: 'Forward' },
];

describe('goalie-in-net selection', () => {
  it('uses the explicitly selected goalie when two goalies are rostered', () => {
    expect(
      resolveGoalieInNetSelection(
        { kind: 'goalie', playerId: 'goalie-b' },
        opposingRoster,
      ),
    ).toEqual({ ok: true, goalieInNetId: 'goalie-b' });
  });

  it('rejects a player who is not a goalie on the opposing roster', () => {
    expect(
      resolveGoalieInNetSelection(
        { kind: 'goalie', playerId: 'skater-a' },
        opposingRoster,
      ),
    ).toEqual({ ok: false, error: 'Select a valid opposing goalie.' });
  });

  it('allows null attribution only after an explicit not-recorded acknowledgement', () => {
    expect(
      resolveGoalieInNetSelection({ kind: 'not-recorded' }, opposingRoster),
    ).toEqual({ ok: true, goalieInNetId: null });
    expect(
      resolveGoalieInNetSelection({ kind: 'unselected' }, opposingRoster),
    ).toEqual({ ok: false, error: 'Select the goalie in net or explicitly mark it not recorded.' });
  });
});
