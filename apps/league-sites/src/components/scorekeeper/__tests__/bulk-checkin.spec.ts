import { confirmUndecidedPlayers } from '../ui-reliability';

type Player = {
  id: string;
  fullName: string;
  checkinStatus: 'confirmed' | 'tentative' | 'out' | null;
};

describe('All IN partial failure handling', () => {
  it('preserves OUT conflicts and confirms only successful individual requests', async () => {
    const players: Player[] = [
      { id: 'already-in', fullName: 'Already In', checkinStatus: 'confirmed' },
      { id: 'out', fullName: 'Must Stay Out', checkinStatus: 'out' },
      { id: 'success', fullName: 'Successful Player', checkinStatus: null },
      { id: 'failure', fullName: 'Failed Player', checkinStatus: 'tentative' },
    ];
    const requested: string[] = [];

    const result = await confirmUndecidedPlayers(players, async (player) => {
      requested.push(player.id);
      return player.id === 'success'
        ? { success: true }
        : { success: false, error: 'database unavailable' };
    });

    expect(requested).toEqual(['success', 'failure']);
    expect(result.players.map((player) => [player.id, player.checkinStatus])).toEqual([
      ['already-in', 'confirmed'],
      ['out', 'out'],
      ['success', 'confirmed'],
      ['failure', 'tentative'],
    ]);
    expect(result.errors).toEqual(['Failed Player: database unavailable']);
  });

  it('turns rejected individual requests into a partial error without losing state', async () => {
    const players: Player[] = [
      { id: 'failure', fullName: 'Network Failure', checkinStatus: null },
    ];

    const result = await confirmUndecidedPlayers(players, async () => {
      throw new Error('network down');
    });

    expect(result.players[0].checkinStatus).toBeNull();
    expect(result.errors).toEqual(['Network Failure: network down']);
  });
});
