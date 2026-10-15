'use client';

import { useState } from 'react';
import type { PlayerData } from '@/lib/actions/scorekeeper';
import { addGoalEvent } from '@/lib/actions/scorekeeper';
import { PlayerPicker } from './PlayerPicker';
import {
  OFFLINE_ACTION_ERROR,
  resolveGoalieInNetSelection,
  type GoalieInNetSelection,
} from './ui-reliability';

function isGoaliePosition(position: string | null | undefined): boolean {
  if (!position) return false;
  const normalized = position.trim().toLowerCase();
  return normalized === 'goalie' || normalized === 'g';
}

interface GoalEntryProps {
  gameId: string;
  teamId: string;
  teamType: 'home' | 'away';
  teamName: string;
  teamColor?: string | null;
  roster: PlayerData[];
  opposingTeamName: string;
  opposingRoster: PlayerData[];
  period: number | null;
  gameTimeSeconds: number | null;
  isPowerPlay: boolean;
  isShortHanded: boolean;
  isEmptyNet: boolean;
  isOnline: boolean;
  onComplete: () => void;
  onCancel: () => void;
}

type Step = 'goalie' | 'scorer' | 'assist1' | 'assist2';

export function GoalEntry({
  gameId,
  teamId,
  teamType,
  teamName,
  teamColor,
  roster,
  opposingTeamName,
  opposingRoster,
  period,
  gameTimeSeconds,
  isPowerPlay,
  isShortHanded,
  isEmptyNet,
  isOnline,
  onComplete,
  onCancel,
}: GoalEntryProps) {
  const [step, setStep] = useState<Step>('goalie');
  const [goalieSelection, setGoalieSelection] = useState<GoalieInNetSelection>({ kind: 'unselected' });
  const [scorer, setScorer] = useState<PlayerData | null>(null);
  const [assist1, setAssist1] = useState<PlayerData | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const skaters = roster.filter(p => !isGoaliePosition(p.position));
  const opposingGoalies = opposingRoster.filter(p => isGoaliePosition(p.position));

  async function submitGoal(scorerPlayer: PlayerData, a1?: PlayerData | null, a2?: PlayerData | null) {
    if (isPending) return;
    if (!isOnline) {
      setSubmitError(OFFLINE_ACTION_ERROR);
      return;
    }
    const goalieResult = resolveGoalieInNetSelection(goalieSelection, opposingRoster);
    if (!goalieResult.ok) {
      setSubmitError(goalieResult.error);
      return;
    }
    setIsPending(true);
    setSubmitError(null);
    try {
      const result = await addGoalEvent({
        gameId,
        teamId,
        teamType,
        scorerId: scorerPlayer.id,
        assist1Id: a1?.id,
        assist2Id: a2?.id,
        period,
        gameTimeSeconds,
        isPowerPlay,
        isShortHanded,
        isEmptyNet,
        goalieInNetId: goalieResult.goalieInNetId ?? undefined,
      });
      if (!result.success) {
        setSubmitError(result.error ?? 'Failed to save goal. Please try again.');
        return;
      }
      onComplete();
    } catch {
      setSubmitError('Failed to save goal. Your selections are still here.');
    } finally {
      setIsPending(false);
    }
  }

  function handleGoalieSelect(player: PlayerData) {
    const selection: GoalieInNetSelection = { kind: 'goalie', playerId: player.id };
    const result = resolveGoalieInNetSelection(selection, opposingRoster);
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }
    setGoalieSelection(selection);
    setStep('scorer');
  }

  function acknowledgeGoalieNotRecorded() {
    setGoalieSelection({ kind: 'not-recorded' });
    setStep('scorer');
  }

  function handleScorerSelect(player: PlayerData) {
    setScorer(player);
    setStep('assist1');
  }

  function handleAssist1Select(player: PlayerData) {
    setAssist1(player);
    setStep('assist2');
  }

  function handleAssist2Select(player: PlayerData) {
    // Auto-save immediately
    if (scorer) {
      submitGoal(scorer, assist1, player);
    }
  }

  function skipAssist1() {
    // Unassisted goal — auto-save
    if (scorer) {
      submitGoal(scorer);
    }
  }

  function skipAssist2() {
    // No second assist — auto-save
    if (scorer) {
      submitGoal(scorer, assist1);
    }
  }

  if (isPending) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div className="relative bg-[var(--color-background)] rounded-2xl p-6 text-center animate-in zoom-in-95 duration-150">
          <div className="text-2xl mb-2">&#127946;</div>
          <p className="font-semibold text-[var(--color-text-primary)]">Saving goal...</p>
        </div>
      </div>
    );
  }

  if (submitError) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
        <div className="relative bg-[var(--color-background)] rounded-2xl p-6 text-center animate-in zoom-in-95 duration-150 max-w-sm mx-4">
          <div className="text-2xl mb-2">&#9888;&#65039;</div>
          <p className="font-semibold text-[var(--color-text-primary)] mb-1">Goal not saved</p>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">{submitError}</p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)]"
            >
              Cancel
            </button>
            <button
              onClick={() => { setSubmitError(null); }}
              className="flex-1 py-2 rounded-lg bg-[var(--league-primary,#d4af37)] text-sm font-semibold text-black"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'goalie') {
    return (
      <PlayerPicker
        players={opposingGoalies}
        teamName={opposingTeamName}
        onSelect={handleGoalieSelect}
        onClose={onCancel}
        goaliesOnly
        title="Goalie in net for goal against"
        allowSkip
        skipLabel="Goalie Not Recorded"
        onSkip={acknowledgeGoalieNotRecorded}
      />
    );
  }

  // Player selection steps
  const availablePlayers = step === 'assist1'
    ? skaters.filter(p => p.id !== scorer?.id)
    : step === 'assist2'
      ? skaters.filter(p => p.id !== scorer?.id && p.id !== assist1?.id)
      : skaters;

  const title = step === 'scorer'
    ? `Goal Scorer - ${teamName}`
    : step === 'assist1'
      ? `Primary Assist (optional)`
      : `Secondary Assist (optional)`;

  return (
    <PlayerPicker
      players={availablePlayers}
      teamName={teamName}
      teamColor={teamColor}
      onSelect={
        step === 'scorer'
          ? handleScorerSelect
          : step === 'assist1'
            ? handleAssist1Select
            : handleAssist2Select
      }
      onClose={step === 'scorer' ? onCancel : step === 'assist1' ? skipAssist1 : skipAssist2}
      title={title}
      allowSkip={step === 'assist1' || step === 'assist2'}
      skipLabel={step === 'assist1' ? 'Unassisted Goal' : 'No Second Assist'}
      onSkip={step === 'assist1' ? skipAssist1 : skipAssist2}
    />
  );
}
