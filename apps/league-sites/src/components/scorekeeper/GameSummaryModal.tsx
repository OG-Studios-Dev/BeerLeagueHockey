'use client';

import React, { useState, useEffect } from 'react';
import {
  getGameSummary,
  submitGameForVerification,
  saveScorekeeperNotes,
  type GameData,
  type CaptainVerificationMode,
  type ScorekeeperCaptureStatus,
  type ScorekeeperGoalieAppearance,
  type ScorekeeperSession,
} from '@/lib/actions/scorekeeper';
import { OFFLINE_ACTION_ERROR } from './ui-reliability';

export type PenaltyCaptureChoice =
  | 'none_confirmed'
  | 'all_recorded'
  | 'not_fully_recorded';
export type GoalieCaptureChoice = 'all_recorded' | 'not_tracked_or_partial';

const CAPTURE_REVIEW_REQUIRED_ERROR =
  'Choose a penalty review and a goalie review before submitting.';
const GOALIE_APPEARANCE_REQUIRED_ERROR =
  'Select every goalie who appeared for both teams before marking goalie capture complete.';

interface CaptureStatusReviewProps {
  penaltyChoice: PenaltyCaptureChoice | null;
  goalieChoice: GoalieCaptureChoice | null;
  onPenaltyChoiceChange: (choice: PenaltyCaptureChoice) => void;
  onGoalieChoiceChange: (choice: GoalieCaptureChoice) => void;
  goalieOptions?: Array<{ playerId: string; label: string; teamType: 'home' | 'away'; checked: boolean }>;
  onGoalieAppearanceChange?: (playerId: string, checked: boolean) => void;
}

export function CaptureStatusReview({
  penaltyChoice,
  goalieChoice,
  onPenaltyChoiceChange,
  onGoalieChoiceChange,
  goalieOptions = [],
  onGoalieAppearanceChange,
}: CaptureStatusReviewProps) {
  const optionClass = 'flex min-h-11 items-start gap-3 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200';

  return (
    <section className="rounded-xl border border-cyan-500/20 bg-neutral-800 p-4" aria-labelledby="capture-review-heading">
      <h3 id="capture-review-heading" className="text-sm font-semibold text-white">
        Required stat capture review
      </h3>
      <p className="mt-1 text-xs text-neutral-400">
        Choose what was actually tracked. Zero recorded events does not mean tracking was complete.
      </p>

      <fieldset className="mt-4 space-y-2">
        <legend className="text-sm font-medium text-neutral-300">Penalty review</legend>
        <label className={optionClass}>
          <input
            type="radio"
            name="penalty-capture-review"
            value="none_confirmed"
            required
            checked={penaltyChoice === 'none_confirmed'}
            onChange={() => onPenaltyChoiceChange('none_confirmed')}
            className="mt-0.5 h-4 w-4 accent-cyan-500"
          />
          <span>No penalties confirmed</span>
        </label>
        <label className={optionClass}>
          <input
            type="radio"
            name="penalty-capture-review"
            value="all_recorded"
            required
            checked={penaltyChoice === 'all_recorded'}
            onChange={() => onPenaltyChoiceChange('all_recorded')}
            className="mt-0.5 h-4 w-4 accent-cyan-500"
          />
          <span>All penalties recorded</span>
        </label>
        <label className={optionClass}>
          <input
            type="radio"
            name="penalty-capture-review"
            value="not_fully_recorded"
            required
            checked={penaltyChoice === 'not_fully_recorded'}
            onChange={() => onPenaltyChoiceChange('not_fully_recorded')}
            className="mt-0.5 h-4 w-4 accent-cyan-500"
          />
          <span>Not fully recorded</span>
        </label>
      </fieldset>

      <fieldset className="mt-4 space-y-2">
        <legend className="text-sm font-medium text-neutral-300">Goalie review</legend>
        <label className={optionClass}>
          <input
            type="radio"
            name="goalie-capture-review"
            value="all_recorded"
            required
            checked={goalieChoice === 'all_recorded'}
            onChange={() => onGoalieChoiceChange('all_recorded')}
            className="mt-0.5 h-4 w-4 accent-cyan-500"
          />
          <span>All saves/shots and goalie assignments recorded</span>
        </label>
        <label className={optionClass}>
          <input
            type="radio"
            name="goalie-capture-review"
            value="not_tracked_or_partial"
            required
            checked={goalieChoice === 'not_tracked_or_partial'}
            onChange={() => onGoalieChoiceChange('not_tracked_or_partial')}
            className="mt-0.5 h-4 w-4 accent-cyan-500"
          />
          <span>Not tracked/partial</span>
        </label>
      </fieldset>
      {goalieChoice === 'all_recorded' && goalieOptions.length > 0 && (
        <fieldset className="mt-3 space-y-2">
          <legend className="text-sm font-medium text-neutral-300">Goalies who appeared</legend>
          {goalieOptions.map((goalie) => (
            <label key={`${goalie.teamType}-${goalie.playerId}`} className={optionClass}>
              <input
                type="checkbox"
                checked={goalie.checked}
                onChange={(event) => onGoalieAppearanceChange?.(goalie.playerId, event.target.checked)}
                className="mt-0.5 h-4 w-4 accent-cyan-500"
              />
              <span>{goalie.label} ({goalie.teamType})</span>
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );
}

function toCaptureStatus(
  penaltyChoice: PenaltyCaptureChoice,
  goalieChoice: GoalieCaptureChoice,
): { penalties: ScorekeeperCaptureStatus; goalies: ScorekeeperCaptureStatus } {
  return {
    penalties: penaltyChoice === 'not_fully_recorded' ? 'not_recorded' : 'complete',
    goalies: goalieChoice === 'not_tracked_or_partial' ? 'not_recorded' : 'complete',
  };
}

interface GameSummaryReviewInput {
  gameId: string;
  notes: string;
  originalNotes: string;
  penaltyChoice: PenaltyCaptureChoice | null;
  goalieChoice: GoalieCaptureChoice | null;
  goalieAppearances?: ScorekeeperGoalieAppearance[];
}

export async function submitGameSummaryReview(
  input: GameSummaryReviewInput,
  dependencies: {
    saveNotes: typeof saveScorekeeperNotes;
    submit: typeof submitGameForVerification;
  } = {
    saveNotes: saveScorekeeperNotes,
    submit: submitGameForVerification,
  },
) {
  if (!input.penaltyChoice || !input.goalieChoice) {
    return { success: false, error: CAPTURE_REVIEW_REQUIRED_ERROR };
  }
  if (input.goalieChoice === 'all_recorded') {
    const appearances = input.goalieAppearances ?? [];
    if (!appearances.some((appearance) => appearance.teamType === 'home')
      || !appearances.some((appearance) => appearance.teamType === 'away')) {
      return { success: false, error: GOALIE_APPEARANCE_REQUIRED_ERROR };
    }
  }

  const trimmedNotes = input.notes.trim();
  if (trimmedNotes !== input.originalNotes.trim()) {
    const notesResult = await dependencies.saveNotes(input.gameId, trimmedNotes);
    if (!notesResult.success) {
      return {
        success: false,
        error: notesResult.error || 'Failed to save notes. Submission was not started.',
      };
    }
  }

  return dependencies.submit(
    input.gameId,
    {
      ...toCaptureStatus(input.penaltyChoice, input.goalieChoice),
      goalieAppearances: input.goalieChoice === 'all_recorded'
        ? input.goalieAppearances ?? []
        : [],
    },
  );
}

interface AttendanceReviewPlayer {
  id: string;
  fullName: string;
  checkinStatus: 'confirmed' | 'tentative' | 'out' | null;
}

interface AttendanceReviewEvent {
  playerId: string | null;
  assist1PlayerId: string | null;
  assist2PlayerId: string | null;
  deletedAt: string | null;
}

export function getAttendanceReviewWarnings(
  checkins: { homeTeam: AttendanceReviewPlayer[]; awayTeam: AttendanceReviewPlayer[] } | undefined,
  events: AttendanceReviewEvent[],
): string[] {
  if (!checkins) return [];

  const players = [...checkins.homeTeam, ...checkins.awayTeam];
  const incompleteCount = players.filter(
    (player) => player.checkinStatus === null || player.checkinStatus === 'tentative',
  ).length;
  const activeParticipantIds = new Set(
    events
      .filter((event) => !event.deletedAt)
      .flatMap((event) => [event.playerId, event.assist1PlayerId, event.assist2PlayerId])
      .filter((playerId): playerId is string => Boolean(playerId)),
  );
  const conflictingNames = players
    .filter((player) => player.checkinStatus === 'out' && activeParticipantIds.has(player.id))
    .map((player) => player.fullName);
  const warnings: string[] = [];

  if (incompleteCount > 0) {
    warnings.push(
      `Attendance review incomplete: ${incompleteCount} ${incompleteCount === 1 ? 'player is' : 'players are'} still tentative or not marked.`,
    );
  }
  if (conflictingNames.length > 0) {
    warnings.push(
      `Attendance conflict: ${conflictingNames.join(', ')} ${conflictingNames.length === 1 ? 'is' : 'are'} marked OUT but appears in recorded events.`,
    );
  }

  return warnings;
}

interface GameSummaryModalProps {
  gameId: string;
  game: GameData;
  leagueSlug: string;
  session: ScorekeeperSession;
  isOnline: boolean;
  attendanceWarnings?: string[];
  onClose: () => void;
}

/**
 * Game Summary Modal
 * Shows complete game summary and allows submission for captain verification
 */
export function GameSummaryModal({
  gameId,
  game,
  leagueSlug,
  session,
  isOnline,
  attendanceWarnings = [],
  onClose,
}: GameSummaryModalProps) {
  const isCaptainSelfScoring = session.sessionOrigin === 'captain_self_score';
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [verificationLinks, setVerificationLinks] = useState<{
    verificationMode: CaptainVerificationMode;
    autoVerifiedTeamType?: 'home' | 'away';
    homeToken?: string;
    awayToken?: string;
  } | null>(null);
  const [homeVerifiedAt, setHomeVerifiedAt] = useState<string | null>(game.homeVerifiedAt);
  const [awayVerifiedAt, setAwayVerifiedAt] = useState<string | null>(game.awayVerifiedAt);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notes, setNotes] = useState(game.scorekeeperNotes ?? '');
  const [penaltyChoice, setPenaltyChoice] = useState<PenaltyCaptureChoice | null>(null);
  const [goalieChoice, setGoalieChoice] = useState<GoalieCaptureChoice | null>(null);
  const [goalieAppearanceIds, setGoalieAppearanceIds] = useState<Set<string>>(() => new Set());
  const goalieOptions = [
    ...game.homeTeam.roster.filter((player) => player.position === 'Goalie').map((player) => ({
      playerId: player.id, label: player.fullName, teamType: 'home' as const,
      teamId: game.homeTeam.id, checked: goalieAppearanceIds.has(player.id),
    })),
    ...game.awayTeam.roster.filter((player) => player.position === 'Goalie').map((player) => ({
      playerId: player.id, label: player.fullName, teamType: 'away' as const,
      teamId: game.awayTeam.id, checked: goalieAppearanceIds.has(player.id),
    })),
  ];
  const [summary, setSummary] = useState<{
    homeGoals: number;
    awayGoals: number;
    homePenaltyMinutes: number;
    awayPenaltyMinutes: number;
    homeSaves: number;
    awaySaves: number;
    homeShots: number;
    awayShots: number;
    homePPGoals: number;
    awayPPGoals: number;
    homeSHGoals: number;
    awaySHGoals: number;
    homeENGoals: number;
    awayENGoals: number;
    periods: Array<{ period: number; homeGoals: number; awayGoals: number; homeSaves: number; awaySaves: number }>;
    scorers: Array<{
      playerId: string;
      playerName: string;
      teamType: 'home' | 'away';
      goals: number;
      assists: number;
      ppGoals: number;
      ppAssists: number;
      shGoals: number;
      shAssists: number;
    }>;
    goalies: Array<{
      playerId: string;
      playerName: string;
      teamType: 'home' | 'away';
      saves: number;
      goalsAgainst: number;
      shotsAgainst: number;
      savePercentage: number;
      periodStats: Array<{ period: number; saves: number; goalsAgainst: number }>;
    }>;
  } | null>(null);

  useEffect(() => {
    async function loadSummary() {
      const result = await getGameSummary(gameId);
      if (result.success && result.summary) {
        setSummary(result.summary);
      }
      setIsLoading(false);
    }
    loadSummary();
  }, [gameId]);

  // TODO(Pixel): derive homeVerifiedAt/awayVerifiedAt from props instead of syncing via effect
  useEffect(() => {
    setHomeVerifiedAt(game.homeVerifiedAt);
    setAwayVerifiedAt(game.awayVerifiedAt);
  }, [game.awayVerifiedAt, game.homeVerifiedAt]);

  const handleSubmitForVerification = async () => {
    if (!isOnline) {
      setSubmitError(OFFLINE_ACTION_ERROR);
      return;
    }
    if (!penaltyChoice || !goalieChoice) {
      setSubmitError(CAPTURE_REVIEW_REQUIRED_ERROR);
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const result = await submitGameSummaryReview({
        gameId,
        notes,
        originalNotes: game.scorekeeperNotes ?? '',
        penaltyChoice,
        goalieChoice,
        goalieAppearances: goalieOptions
          .filter((goalie) => goalie.checked)
          .map(({ playerId, teamId, teamType }) => ({ playerId, teamId, teamType })),
      });

      if (result.success && result.verificationMode) {
        setVerificationLinks({
          verificationMode: result.verificationMode,
          autoVerifiedTeamType: result.autoVerifiedTeamType,
          homeToken: result.homeToken,
          awayToken: result.awayToken,
        });

        if (result.autoVerifiedTeamType === 'home') {
          setHomeVerifiedAt(new Date().toISOString());
        }

        if (result.autoVerifiedTeamType === 'away') {
          setAwayVerifiedAt(new Date().toISOString());
        }

        setSubmitted(true);
      } else {
        setSubmitError(result.error || 'Failed to submit for verification');
      }
    } catch {
      setSubmitError('Failed to submit. Your notes and review state are still here.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getBaseUrl = () => {
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
    return '';
  };

  const getVerificationUrl = (token: string) => `${getBaseUrl()}/${leagueSlug}/verify/${token}`;
  const autoVerifiedTeamName = verificationLinks?.autoVerifiedTeamType === 'home'
    ? game.homeTeam.name
    : verificationLinks?.autoVerifiedTeamType === 'away'
      ? game.awayTeam.name
      : null;
  const opposingTeamName = verificationLinks?.autoVerifiedTeamType === 'home'
    ? game.awayTeam.name
    : verificationLinks?.autoVerifiedTeamType === 'away'
      ? game.homeTeam.name
      : null;

  const verificationLinkCards = [
    verificationLinks?.homeToken
      ? {
          key: 'home',
          label: `${game.homeTeam.shortName || 'Home'} Captain Link`,
          token: verificationLinks.homeToken,
        }
      : null,
    verificationLinks?.awayToken
      ? {
          key: 'away',
          label: `${game.awayTeam.shortName || 'Away'} Captain Link`,
          token: verificationLinks.awayToken,
        }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; token: string }>;

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center">
        <div className="bg-neutral-900 w-full md:max-w-2xl md:rounded-2xl p-8">
          <div className="flex items-center justify-center">
            <div className="w-12 h-12 border-4 border-white/10 border-t-cyan-500 rounded-full animate-spin" />
          </div>
          <p className="text-neutral-400 text-center mt-4">Loading game summary...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end md:items-center justify-center overflow-auto">
      <div className="bg-neutral-900 w-full md:max-w-2xl md:rounded-2xl border-t md:border border-white/10 max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 sticky top-0 bg-neutral-900 z-10">
          <div>
            <h2 className="text-lg font-bold text-white">Game Summary</h2>
            <p className="text-sm text-neutral-400">
              Review stats and submit for verification
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-neutral-400 hover:text-white transition-colors touch-manipulation"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-6">
          {submitError && (
            <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {submitError}
            </div>
          )}

          {attendanceWarnings.length > 0 && (
            <div role="status" className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
              {attendanceWarnings.map((warning) => <p key={warning}>{warning}</p>)}
              <p className="text-xs text-amber-100/70">Submission does not change attendance.</p>
            </div>
          )}

          {/* Final Score */}
          <div className="bg-neutral-800 rounded-2xl p-6">
            <h3 className="text-xs text-neutral-500 uppercase tracking-wider text-center mb-4">
              Final Score
            </h3>
            <div className="flex items-center justify-between">
              <div className="flex-1 text-center">
                <p className="text-sm text-neutral-400 mb-1">{game.homeTeam.name}</p>
                <p
                  className="text-5xl font-black"
                  style={{ color: game.homeTeam.primaryColor || '#22D3EE' }}
                >
                  {summary?.homeGoals ?? 0}
                </p>
              </div>
              <div className="px-4">
                <span className="text-cyan-500 font-bold">-</span>
              </div>
              <div className="flex-1 text-center">
                <p className="text-sm text-neutral-400 mb-1">{game.awayTeam.name}</p>
                <p
                  className="text-5xl font-black"
                  style={{ color: game.awayTeam.primaryColor || '#A3A3A3' }}
                >
                  {summary?.awayGoals ?? 0}
                </p>
              </div>
            </div>
          </div>

          {/* Period Breakdown */}
          <div className="bg-neutral-800 rounded-xl p-4">
            <h3 className="text-sm font-medium text-neutral-300 mb-3">Score by Period</h3>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="text-xs text-neutral-500">Team</div>
              {(summary?.periods || []).map((p) => (
                <div key={p.period} className="text-xs text-neutral-500">P{p.period}</div>
              ))}

              <div className="text-sm text-white font-medium truncate">{game.homeTeam.shortName || game.homeTeam.name}</div>
              {(summary?.periods || []).map((p) => (
                <div key={p.period} className="text-sm text-white">{p.homeGoals}</div>
              ))}

              <div className="text-sm text-white font-medium truncate">{game.awayTeam.shortName || game.awayTeam.name}</div>
              {(summary?.periods || []).map((p) => (
                <div key={p.period} className="text-sm text-white">{p.awayGoals}</div>
              ))}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-neutral-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">Shots</h3>
              <div className="flex justify-between">
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">{summary?.homeShots ?? 0}</p>
                  <p className="text-xs text-neutral-500">{game.homeTeam.shortName || 'Home'}</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">{summary?.awayShots ?? 0}</p>
                  <p className="text-xs text-neutral-500">{game.awayTeam.shortName || 'Away'}</p>
                </div>
              </div>
            </div>

            <div className="bg-neutral-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">Penalty Minutes</h3>
              <div className="flex justify-between">
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">{summary?.homePenaltyMinutes ?? 0}</p>
                  <p className="text-xs text-neutral-500">{game.homeTeam.shortName || 'Home'}</p>
                </div>
                <div className="text-center">
                  <p className="text-2xl font-bold text-white">{summary?.awayPenaltyMinutes ?? 0}</p>
                  <p className="text-xs text-neutral-500">{game.awayTeam.shortName || 'Away'}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Special Teams Stats */}
          {summary && (summary.homePPGoals > 0 || summary.awayPPGoals > 0 || summary.homeSHGoals > 0 || summary.awaySHGoals > 0) && (
            <div className="bg-neutral-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">Special Teams</h3>
              <div className="grid grid-cols-3 gap-4 text-center text-sm">
                <div className="text-neutral-500 font-medium">&nbsp;</div>
                <div className="text-neutral-500 font-medium">{game.homeTeam.shortName || 'Home'}</div>
                <div className="text-neutral-500 font-medium">{game.awayTeam.shortName || 'Away'}</div>

                <div className="text-neutral-400 text-left">Power Play Goals</div>
                <div className="text-amber-400 font-semibold">{summary.homePPGoals}</div>
                <div className="text-amber-400 font-semibold">{summary.awayPPGoals}</div>

                <div className="text-neutral-400 text-left">Short-Handed Goals</div>
                <div className="text-purple-400 font-semibold">{summary.homeSHGoals}</div>
                <div className="text-purple-400 font-semibold">{summary.awaySHGoals}</div>

                {(summary.homeENGoals > 0 || summary.awayENGoals > 0) && (
                  <>
                    <div className="text-neutral-400 text-left">Empty Net Goals</div>
                    <div className="text-orange-400 font-semibold">{summary.homeENGoals}</div>
                    <div className="text-orange-400 font-semibold">{summary.awayENGoals}</div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Top Scorers */}
          {summary && summary.scorers.length > 0 && (
            <div className="bg-neutral-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">Scoring Summary</h3>
              <div className="space-y-2">
                {summary.scorers.slice(0, 10).map((scorer) => (
                  <div
                    key={scorer.playerId}
                    className="flex items-center justify-between py-2 border-b border-neutral-700 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs px-2 py-0.5 rounded font-medium"
                        style={{
                          backgroundColor: scorer.teamType === 'home'
                            ? `${game.homeTeam.primaryColor || '#22D3EE'}20`
                            : `${game.awayTeam.primaryColor || '#A3A3A3'}20`,
                          color: scorer.teamType === 'home'
                            ? game.homeTeam.primaryColor || '#22D3EE'
                            : game.awayTeam.primaryColor || '#A3A3A3',
                        }}
                      >
                        {scorer.teamType === 'home' ? game.homeTeam.shortName || 'H' : game.awayTeam.shortName || 'A'}
                      </span>
                      <span className="text-white font-medium">{scorer.playerName}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {scorer.goals > 0 && (
                        <span className="text-emerald-400">{scorer.goals}G</span>
                      )}
                      {scorer.assists > 0 && (
                        <span className="text-blue-400">{scorer.assists}A</span>
                      )}
                      {(scorer.ppGoals > 0 || scorer.ppAssists > 0) && (
                        <span className="text-amber-400 text-xs">
                          {scorer.ppGoals > 0 && `${scorer.ppGoals}PP`}
                          {scorer.ppAssists > 0 && `${scorer.ppAssists > 0 ? '+' : ''}${scorer.ppAssists}A`}
                        </span>
                      )}
                      {scorer.shGoals > 0 && (
                        <span className="text-purple-400 text-xs">{scorer.shGoals}SH</span>
                      )}
                      <span className="text-cyan-400 font-bold">{scorer.goals + scorer.assists}P</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Goalie Stats */}
          {summary && summary.goalies.length > 0 && (
            <div className="bg-neutral-800 rounded-xl p-4">
              <h3 className="text-sm font-medium text-neutral-300 mb-3">Goalie Summary</h3>
              <div className="space-y-4">
                {summary.goalies.map((goalie) => (
                  <div
                    key={goalie.playerId}
                    className="border-b border-neutral-700 last:border-0 pb-4 last:pb-0"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs px-2 py-0.5 rounded font-medium"
                          style={{
                            backgroundColor: goalie.teamType === 'home'
                              ? `${game.homeTeam.primaryColor || '#22D3EE'}20`
                              : `${game.awayTeam.primaryColor || '#A3A3A3'}20`,
                            color: goalie.teamType === 'home'
                              ? game.homeTeam.primaryColor || '#22D3EE'
                              : game.awayTeam.primaryColor || '#A3A3A3',
                          }}
                        >
                          {goalie.teamType === 'home' ? game.homeTeam.shortName || 'H' : game.awayTeam.shortName || 'A'}
                        </span>
                        <span className="text-white font-medium">{goalie.playerName}</span>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-blue-400">{goalie.saves} SV</span>
                        <span className="text-red-400">{goalie.goalsAgainst} GA</span>
                        <span className="text-cyan-400 font-bold">{goalie.savePercentage}%</span>
                      </div>
                    </div>

                    {/* Period-by-period breakdown */}
                    {goalie.periodStats && goalie.periodStats.some(p => p.saves > 0 || p.goalsAgainst > 0) && (
                      <div className="mt-2 grid grid-cols-4 gap-2 text-xs text-center">
                        <div className="text-neutral-500">Period</div>
                        {goalie.periodStats.map((ps) => (
                          <div key={ps.period} className="text-neutral-500">P{ps.period}</div>
                        ))}

                        <div className="text-neutral-400">Saves</div>
                        {goalie.periodStats.map((ps) => (
                          <div key={`sv-${ps.period}`} className="text-blue-400">{ps.saves}</div>
                        ))}

                        <div className="text-neutral-400">Shots</div>
                        {goalie.periodStats.map((ps) => (
                          <div key={`sh-${ps.period}`} className="text-neutral-300">{ps.saves + ps.goalsAgainst}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Verification Status */}
          {submitted && verificationLinks && (
            <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center">
                  <svg className="w-6 h-6 text-cyan-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
                <div>
                  <p className="text-cyan-400 font-semibold">Submitted for Verification</p>
                  <p className="text-sm text-neutral-400">
                    {verificationLinks.verificationMode === 'opponent_only'
                      ? `${autoVerifiedTeamName || 'Your team'} is already verified. Share the remaining link with ${opposingTeamName || 'the opposing captain'}.`
                      : isCaptainSelfScoring
                        ? 'Share these links with both captains to finish verification.'
                        : 'Share these links with both team captains to verify the stats.'}
                  </p>
                </div>
              </div>

              {verificationLinks.verificationMode === 'opponent_only' && verificationLinks.autoVerifiedTeamType && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                  {autoVerifiedTeamName || 'Submitting team'} was auto-verified when the score was submitted.
                </div>
              )}

              <div className="rounded-lg border border-neutral-500/20 bg-neutral-500/10 px-3 py-2 text-xs text-neutral-300">
                No response needed on your end — if the other captain doesn&apos;t confirm within
                24 hours, the game finalizes automatically.
              </div>

              <div className="space-y-3">
                {verificationLinkCards.map((link) => {
                  const url = getVerificationUrl(link.token);

                  return (
                    <div key={link.key} className="bg-neutral-900/50 rounded-lg p-3">
                      <p className="text-xs text-neutral-500 mb-1">{link.label}</p>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-sm text-white bg-neutral-950 px-3 py-2 rounded break-all">
                          {url}
                        </code>
                        <button
                          onClick={() => navigator.clipboard.writeText(url)}
                          className="p-2 text-cyan-400 hover:text-cyan-300 transition-colors touch-manipulation"
                        >
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Verification Status Badges */}
          <div className="bg-neutral-800 rounded-xl p-4">
            <h3 className="text-sm font-medium text-neutral-300 mb-3">Verification Status</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className={`p-3 rounded-lg border ${homeVerifiedAt ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-neutral-900 border-neutral-700'}`}>
                <div className="flex items-center gap-2 mb-1">
                  {homeVerifiedAt ? (
                    <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  <span className={homeVerifiedAt ? 'text-emerald-400' : 'text-neutral-400'}>
                    {game.homeTeam.shortName || 'Home'} Captain
                  </span>
                </div>
                <p className="text-xs text-neutral-500">
                  {homeVerifiedAt
                    ? verificationLinks?.autoVerifiedTeamType === 'home'
                      ? 'Verified when score was submitted'
                      : 'Verified'
                    : 'Pending verification'}
                </p>
              </div>

              <div className={`p-3 rounded-lg border ${awayVerifiedAt ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-neutral-900 border-neutral-700'}`}>
                <div className="flex items-center gap-2 mb-1">
                  {awayVerifiedAt ? (
                    <svg className="w-5 h-5 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  <span className={awayVerifiedAt ? 'text-emerald-400' : 'text-neutral-400'}>
                    {game.awayTeam.shortName || 'Away'} Captain
                  </span>
                </div>
                <p className="text-xs text-neutral-500">
                  {awayVerifiedAt
                    ? verificationLinks?.autoVerifiedTeamType === 'away'
                      ? 'Verified when score was submitted'
                      : 'Verified'
                    : 'Pending verification'}
                </p>
              </div>
            </div>
          </div>

          {!submitted && !game.statsLockedAt && (
            <CaptureStatusReview
              penaltyChoice={penaltyChoice}
              goalieChoice={goalieChoice}
              onPenaltyChoiceChange={(choice) => {
                setPenaltyChoice(choice);
                setSubmitError((error) => error === CAPTURE_REVIEW_REQUIRED_ERROR ? null : error);
              }}
              onGoalieChoiceChange={(choice) => {
                setGoalieChoice(choice);
                setSubmitError((error) => error === CAPTURE_REVIEW_REQUIRED_ERROR ? null : error);
              }}
              goalieOptions={goalieOptions}
              onGoalieAppearanceChange={(playerId, checked) => {
                setGoalieAppearanceIds((current) => {
                  const next = new Set(current);
                  if (checked) next.add(playerId); else next.delete(playerId);
                  return next;
                });
                setSubmitError((error) => error === GOALIE_APPEARANCE_REQUIRED_ERROR ? null : error);
              }}
            />
          )}
        </div>

        {/* Game notes — provide context for a later admin-generated recap */}
        {!submitted && !game.statsLockedAt && (
          <div className="px-4 pb-2">
            <label htmlFor="game-recap-notes" className="block text-sm font-semibold text-white">
              Game notes <span className="font-normal text-neutral-500">(optional)</span>
            </label>
            <p className="mt-0.5 mb-2 text-xs text-neutral-400">
              Anything worth remembering — standout plays, milestones, big saves, ref calls, injuries,
              good banter. These feed the AI recap so it captures what actually happened.
            </p>
            <textarea
              id="game-recap-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="e.g. Sanchez scored his first career hat trick; goalie stood on his head in the 3rd; chippy game but all handshakes after."
              className="w-full rounded-xl bg-neutral-800 border border-neutral-700 px-3 py-2 text-sm text-white
                placeholder:text-neutral-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 resize-none"
            />
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-4 px-6 bg-neutral-800 text-white font-semibold rounded-xl
              hover:bg-neutral-700 transition-colors touch-manipulation min-h-[56px]"
          >
            {submitted ? 'Close' : 'Continue Editing'}
          </button>
          {!submitted && !game.statsLockedAt && (
            <button
              onClick={handleSubmitForVerification}
              disabled={isSubmitting || !isOnline}
              className="flex-1 py-4 px-6 bg-gradient-to-r from-cyan-500 to-blue-500 text-black font-semibold rounded-xl
                hover:shadow-lg hover:shadow-cyan-500/20 disabled:opacity-50 disabled:cursor-not-allowed
                transition-all touch-manipulation min-h-[56px]"
            >
              {isSubmitting ? 'Submitting...' : 'Submit for Verification'}
            </button>
          )}
          {game.statsLockedAt && (
            <div className="flex-1 py-4 px-6 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold rounded-xl text-center min-h-[56px] flex items-center justify-center">
              Stats Locked & Verified
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
