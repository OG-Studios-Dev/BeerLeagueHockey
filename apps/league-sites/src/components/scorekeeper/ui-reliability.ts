export const OFFLINE_ACTION_ERROR =
  'Scoring is unavailable offline. Changes are not saved; reconnect before continuing.';

export function getOfflineActionError(isOnline: boolean): string | null {
  return isOnline ? null : OFFLINE_ACTION_ERROR;
}

export type GoalieInNetSelection =
  | { kind: 'unselected' }
  | { kind: 'goalie'; playerId: string }
  | { kind: 'not-recorded' };

interface GoalieRosterEntry {
  id: string;
  position: string | null | undefined;
}

function isGoaliePosition(position: string | null | undefined): boolean {
  const normalized = position?.trim().toLowerCase();
  return normalized === 'goalie' || normalized === 'g';
}

export function resolveGoalieInNetSelection(
  selection: GoalieInNetSelection,
  opposingRoster: GoalieRosterEntry[],
): { ok: true; goalieInNetId: string | null } | { ok: false; error: string } {
  if (selection.kind === 'not-recorded') {
    return { ok: true, goalieInNetId: null };
  }

  if (selection.kind === 'unselected') {
    return {
      ok: false,
      error: 'Select the goalie in net or explicitly mark it not recorded.',
    };
  }

  const validGoalie = opposingRoster.some(
    (player) => player.id === selection.playerId && isGoaliePosition(player.position),
  );
  return validGoalie
    ? { ok: true, goalieInNetId: selection.playerId }
    : { ok: false, error: 'Select a valid opposing goalie.' };
}

interface CheckinStateEntry {
  id: string;
  fullName: string;
  checkinStatus: 'confirmed' | 'tentative' | 'out' | null;
}

interface CheckinUpdateResult {
  success: boolean;
  error?: string;
}

export async function confirmUndecidedPlayers<T extends CheckinStateEntry>(
  players: T[],
  update: (player: T) => Promise<CheckinUpdateResult>,
): Promise<{ players: T[]; errors: string[] }> {
  // An explicit OUT is a conflict, not an undecided value. Bulk IN must never overwrite it.
  const pending = players.filter(
    (player) => player.checkinStatus === null || player.checkinStatus === 'tentative',
  );
  const outcomes = await Promise.all(
    pending.map(async (player) => {
      try {
        const result = await update(player);
        return {
          player,
          success: result.success,
          error: result.error || 'update failed',
        };
      } catch (error) {
        return {
          player,
          success: false,
          error: error instanceof Error ? error.message : 'request failed',
        };
      }
    }),
  );

  const confirmedIds = new Set(
    outcomes.filter((outcome) => outcome.success).map((outcome) => outcome.player.id),
  );
  return {
    players: players.map((player) =>
      confirmedIds.has(player.id)
        ? { ...player, checkinStatus: 'confirmed' as const }
        : player,
    ),
    errors: outcomes
      .filter((outcome) => !outcome.success)
      .map((outcome) => `${outcome.player.fullName}: ${outcome.error}`),
  };
}
