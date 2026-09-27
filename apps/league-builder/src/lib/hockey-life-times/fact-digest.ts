import 'server-only';

import { createHash } from 'node:crypto';
import {
  assessReadiness,
  type ReadinessResult,
  type NewspaperGameInput,
  type NewspaperGoalInput,
  type NewspaperProfileInput,
  type NewspaperStandingInput,
} from './domain';

interface PublicationFacts {
  games: NewspaperGameInput[];
  goals: NewspaperGoalInput[];
  profiles: NewspaperProfileInput[];
  standings: NewspaperStandingInput[];
  upcoming: NewspaperGameInput[];
  playerStats: Array<{ gameId: string; playerId: string; teamId: string; goals: number; assists: number }>;
}

export function canonicalFactDigest(input: PublicationFacts): string {
  const byId = <T extends { id: string }>(values: T[]) => [...values].sort((a, b) => a.id.localeCompare(b.id));
  const canonical = {
    games: byId(input.games),
    goals: byId(input.goals),
    profiles: byId(input.profiles).map(({ id, name, photoUrl }) => ({ id, name, photoUrl: photoUrl || null })),
    standings: [...input.standings].sort((a, b) => a.teamId.localeCompare(b.teamId)),
    upcoming: byId(input.upcoming),
    playerStats: [...input.playerStats].sort((a, b) => a.gameId.localeCompare(b.gameId) || a.playerId.localeCompare(b.playerId)),
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function assertFreshPublicationFacts(
  snapshot: { gameIds: string[]; factPackDigest?: string },
  current: PublicationFacts,
  leagueId: string,
  seasonId: string,
): ReadinessResult {
  const readiness = assessReadiness(current.games, leagueId, seasonId);
  if (!readiness.ready) {
    throw new Error(`NEWSPAPER_FACTS_CHANGED: Source games are no longer publication-ready. Regenerate the draft and review it again. ${readiness.errors.join(' ')}`);
  }
  const reviewedGameIds = [...snapshot.gameIds].sort();
  const currentGameIds = current.games.map((game) => game.id).sort();
  if (JSON.stringify(reviewedGameIds) !== JSON.stringify(currentGameIds)) {
    throw new Error('NEWSPAPER_FACTS_CHANGED: The covered source game set changed after review. Regenerate the draft and review it again.');
  }
  if (!snapshot.factPackDigest || canonicalFactDigest(current) !== snapshot.factPackDigest) {
    throw new Error('NEWSPAPER_FACTS_CHANGED: Source facts changed after this draft was reviewed. Regenerate the draft and review it again.');
  }
  return readiness;
}
