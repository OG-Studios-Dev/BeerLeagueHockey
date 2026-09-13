'use client';

import { useState } from 'react';
import type { PlayerData } from '@/lib/actions/scorekeeper';
import { addShotEvent } from '@/lib/actions/scorekeeper';
import { PlayerPicker } from './PlayerPicker';
import { OFFLINE_ACTION_ERROR } from './ui-reliability';

function isGoaliePosition(position: string | null | undefined): boolean {
  if (!position) return false;
  const normalized = position.trim().toLowerCase();
  return normalized === 'goalie' || normalized === 'g';
}

interface ShotEntryProps {
  gameId: string;
  /** The team whose goalie made the save (defending team) */
  defendingTeamId: string;
  defendingTeamType: 'home' | 'away';
  /** Goalie roster from defending team */
  goalies: PlayerData[];
  /** Skaters from the shooting team */
  shootingRoster: PlayerData[];
  shootingTeamName: string;
  shootingTeamColor?: string | null;
  period: number | null;
  gameTimeSeconds: number | null;
  isOnline: boolean;
  onComplete: () => void;
  onCancel: () => void;
}

export function ShotEntry({
  gameId,
  defendingTeamId,
  defendingTeamType,
  goalies,
  shootingRoster,
  shootingTeamName,
  shootingTeamColor,
  period,
  gameTimeSeconds,
  isOnline,
  onComplete,
  onCancel,
}: ShotEntryProps) {
  const [step, setStep] = useState<'goalie' | 'shooter'>('goalie');
  const [goalie, setGoalie] = useState<PlayerData | null>(
    // Auto-select if only one goalie
    goalies.length === 1 ? goalies[0] : null
  );
  const [isPending, setIsPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // If only one goalie, skip to shooter selection
  if (step === 'goalie' && goalies.length === 1 && !goalie) {
    setGoalie(goalies[0]);
    setStep('shooter');
  }

  function handleGoalieSelect(g: PlayerData) {
    setGoalie(g);
    setStep('shooter');
  }

  async function handleShooterSelect(shooter: PlayerData) {
    if (isPending) return;
    if (!isOnline) {
      setSubmitError(OFFLINE_ACTION_ERROR);
      return;
    }
    if (!goalie) {
      // No goalie registered on this team — dismiss without recording
      onCancel();
      return;
    }
    setIsPending(true);
    setSubmitError(null);
    try {
      const result = await addShotEvent({
        gameId,
        teamId: defendingTeamId,
        teamType: defendingTeamType,
        goalieId: goalie.id,
        shotByPlayerId: shooter.id,
        period,
        gameTimeSeconds,
      });
      if (!result.success) {
        setSubmitError(result.error || 'Failed to save shot. Please try again.');
        setIsPending(false);
        return;
      }
    } catch (err) {
      console.error('Failed to save shot:', err);
      setSubmitError('Failed to save shot. Please try again.');
      setIsPending(false);
      return;
    }
    onComplete();
  }

  async function handleQuickSave() {
    // Record save without specifying shooter
    if (isPending) return;
    if (!isOnline) {
      setSubmitError(OFFLINE_ACTION_ERROR);
      return;
    }
    if (!goalie) {
      // No goalie registered on this team — dismiss without recording
      onCancel();
      return;
    }
    setIsPending(true);
    setSubmitError(null);
    try {
      const result = await addShotEvent({
        gameId,
        teamId: defendingTeamId,
        teamType: defendingTeamType,
        goalieId: goalie.id,
        period,
        gameTimeSeconds,
      });
      if (!result.success) {
        setSubmitError(result.error || 'Failed to save shot. Please try again.');
        setIsPending(false);
        return;
      }
    } catch (err) {
      console.error('Failed to save shot:', err);
      setSubmitError('Failed to save shot. Please try again.');
      setIsPending(false);
      return;
    }
    onComplete();
  }

  if (submitError) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
        <div className="relative bg-[var(--color-background)] rounded-2xl p-6 text-center animate-in zoom-in-95 duration-150 max-w-sm mx-4">
          <div className="text-2xl mb-2">&#9888;&#65039;</div>
          <p className="font-semibold text-[var(--color-text-primary)] mb-1">Save not recorded</p>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">{submitError}</p>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="flex-1 py-2 rounded-lg border border-[var(--color-border)] text-sm text-[var(--color-text-secondary)]"
            >
              Cancel
            </button>
            <button
              onClick={() => setSubmitError(null)}
              className="flex-1 py-2 rounded-lg bg-[var(--league-primary,#d4af37)] text-sm font-semibold text-black"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'goalie' && goalies.length > 1) {
    return (
      <PlayerPicker
        players={goalies}
        teamName="Select Goalie"
        onSelect={handleGoalieSelect}
        onClose={onCancel}
        goaliesOnly
        title="Which goalie made the save?"
      />
    );
  }

  // Shooter selection (optional) — uses skip button inside PlayerPicker
  const skaters = shootingRoster.filter(p => !isGoaliePosition(p.position));

  return (
    <PlayerPicker
      players={skaters}
      teamName={shootingTeamName}
      teamColor={shootingTeamColor}
      onSelect={handleShooterSelect}
      onClose={handleQuickSave}
      title="Shot by (optional)"
      allowSkip
      skipLabel={isPending ? 'Saving...' : 'Save Without Shooter'}
      onSkip={handleQuickSave}
    />
  );
}
