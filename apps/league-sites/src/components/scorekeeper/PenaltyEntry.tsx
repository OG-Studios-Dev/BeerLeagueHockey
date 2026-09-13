'use client';

import { useState } from 'react';
import type { PlayerData } from '@/lib/actions/scorekeeper';
import { addPenaltyEvent } from '@/lib/actions/scorekeeper';
import { PlayerPicker } from './PlayerPicker';
import { OFFLINE_ACTION_ERROR } from './ui-reliability';

export interface PenaltyRule {
  type: string;
  minutes: number;
}

interface PenaltyEntryProps {
  gameId: string;
  teamId: string;
  teamType: 'home' | 'away';
  teamName: string;
  teamColor?: string | null;
  roster: PlayerData[];
  period: number | null;
  gameTimeSeconds: number | null;
  /** Custom penalty rules from league settings (optional) */
  penaltyRules?: PenaltyRule[];
  isOnline: boolean;
  onComplete: () => void;
  onCancel: () => void;
}

/** Default NHL-style penalties used when no league config is set */
export const DEFAULT_PENALTIES: PenaltyRule[] = [
  // Minors (2 min)
  { type: 'Tripping', minutes: 2 },
  { type: 'Hooking', minutes: 2 },
  { type: 'Holding', minutes: 2 },
  { type: 'Slashing', minutes: 2 },
  { type: 'Interference', minutes: 2 },
  { type: 'High Sticking', minutes: 2 },
  { type: 'Roughing', minutes: 2 },
  { type: 'Cross-Checking', minutes: 2 },
  { type: 'Boarding', minutes: 2 },
  { type: 'Elbowing', minutes: 2 },
  { type: 'Charging', minutes: 2 },
  { type: 'Delay of Game', minutes: 2 },
  { type: 'Too Many Men', minutes: 2 },
  { type: 'Unsportsmanlike Conduct', minutes: 2 },
  // Double minor (4 min)
  { type: 'High Sticking (Double)', minutes: 4 },
  // Majors (5 min)
  { type: 'Spearing', minutes: 5 },
  { type: 'Fighting', minutes: 5 },
  { type: 'Checking from Behind', minutes: 5 },
  { type: 'Match Penalty', minutes: 5 },
  // Misconduct (10 min)
  { type: 'Game Misconduct', minutes: 10 },
];

type Step = 'player' | 'penalty';

const SEVERITY_ORDER = [2, 4, 5, 10];
const SEVERITY_LABELS: Record<number, string> = {
  2: 'Minor',
  4: 'Double Minor',
  5: 'Major',
  10: 'Misconduct',
};
const SEVERITY_COLORS: Record<number, { bg: string; text: string; badge: string }> = {
  2: { bg: 'bg-yellow-500/10', text: 'text-yellow-400', badge: 'bg-yellow-500/10 text-yellow-400' },
  4: { bg: 'bg-orange-500/10', text: 'text-orange-400', badge: 'bg-orange-500/10 text-orange-400' },
  5: { bg: 'bg-red-500/10', text: 'text-red-400', badge: 'bg-red-500/10 text-red-400' },
  10: { bg: 'bg-gray-500/10', text: 'text-gray-400', badge: 'bg-gray-500/10 text-gray-400' },
};

export function PenaltyEntry({
  gameId,
  teamId,
  teamType,
  teamName,
  teamColor,
  roster,
  period,
  gameTimeSeconds,
  penaltyRules,
  isOnline,
  onComplete,
  onCancel,
}: PenaltyEntryProps) {
  const [step, setStep] = useState<Step>('player');
  const [player, setPlayer] = useState<PlayerData | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const penalties = penaltyRules && penaltyRules.length > 0 ? penaltyRules : DEFAULT_PENALTIES;

  // Group by minutes
  const grouped = SEVERITY_ORDER
    .map(mins => ({
      minutes: mins,
      label: SEVERITY_LABELS[mins] || `${mins} min`,
      colors: SEVERITY_COLORS[mins] || SEVERITY_COLORS[2],
      items: penalties.filter(p => p.minutes === mins),
    }))
    .filter(g => g.items.length > 0);

  function handlePlayerSelect(p: PlayerData) {
    setPlayer(p);
    setStep('penalty');
  }

  async function handlePenaltySelect(type: string, minutes: number) {
    if (!player || isPending) return;
    if (!isOnline) {
      setSubmitError(OFFLINE_ACTION_ERROR);
      return;
    }
    setIsPending(true);
    setSubmitError(null);
    try {
      const result = await addPenaltyEvent({
        gameId,
        teamId,
        teamType,
        playerId: player.id,
        period,
        gameTimeSeconds,
        penaltyType: type,
        penaltyMinutes: minutes,
      });
      if (!result.success) {
        setSubmitError(result.error ?? 'Failed to save penalty. Please try again.');
        return;
      }
      onComplete();
    } catch {
      setSubmitError('Failed to save penalty. Your selections are still here.');
    } finally {
      setIsPending(false);
    }
  }

  if (step === 'player') {
    return (
      <PlayerPicker
        players={roster}
        teamName={teamName}
        teamColor={teamColor}
        onSelect={handlePlayerSelect}
        onClose={onCancel}
        title="Penalty - Select Player"
      />
    );
  }

  if (submitError) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
        <div className="relative bg-[var(--color-background)] rounded-2xl p-6 text-center animate-in zoom-in-95 duration-150 max-w-sm mx-4">
          <div className="text-2xl mb-2">&#9888;&#65039;</div>
          <p className="font-semibold text-[var(--color-text-primary)] mb-1">Penalty not saved</p>
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

  // Penalty type selection — full-height bottom sheet with severity groups
  return (
    <div className="fixed inset-0 z-50 flex flex-col">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative mt-auto max-h-[85vh] flex flex-col bg-[var(--color-background)] rounded-t-2xl border-t border-[var(--color-border)] animate-in slide-in-from-bottom duration-200">
        {/* Team color accent bar */}
        <div
          className="h-1 rounded-t-2xl flex-shrink-0"
          style={{ backgroundColor: teamColor || 'var(--league-primary, #d4af37)' }}
        />

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] flex-shrink-0">
          <div>
            <h3 className="font-semibold text-[var(--color-text-primary)]">
              #{player?.jerseyNumber} {player?.fullName}
            </h3>
            <p className="text-xs text-[var(--color-text-secondary)]">Select penalty type</p>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg hover:bg-[var(--color-surface)] transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Penalty List — grouped by severity */}
        <div className="flex-1 overflow-y-auto pb-safe">
          {grouped.map(group => (
            <div key={group.minutes}>
              {/* Group Header */}
              <div className="sticky top-0 z-10 px-4 py-2 bg-[var(--color-background)]/95 backdrop-blur-sm border-b border-[var(--color-border)]">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold uppercase tracking-wider ${group.colors.text}`}>
                    {group.label}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${group.colors.badge}`}>
                    {group.minutes} min
                  </span>
                </div>
              </div>

              {/* Penalty Items */}
              <div className="px-2 py-1">
                {group.items.map(p => (
                  <button
                    key={p.type}
                    onClick={() => handlePenaltySelect(p.type, p.minutes)}
                    disabled={isPending}
                    className={`w-full flex items-center justify-between px-4 py-3.5 rounded-xl transition-colors text-left active:scale-[0.98] disabled:opacity-50 ${group.colors.bg} hover:opacity-80 mb-1`}
                  >
                    <span className="text-sm font-medium text-[var(--color-text-primary)]">
                      {p.type}
                    </span>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${group.colors.badge}`}>
                      {p.minutes} min
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
