'use client';

import { useState } from 'react';
import type { GameEventData, PlayerData } from '@/lib/actions/scorekeeper';
import { updateGameEvent } from '@/lib/actions/scorekeeper';
import { DEFAULT_PENALTIES, type PenaltyRule } from './PenaltyEntry';
import { OFFLINE_ACTION_ERROR } from './ui-reliability';

interface EventEditModalProps {
  event: GameEventData;
  homeRoster: PlayerData[];
  awayRoster: PlayerData[];
  periodCount: number;
  showTimePeriods: boolean;
  penaltyRules?: PenaltyRule[];
  isOnline: boolean;
  onSaved: () => void;
  onClose: () => void;
}

const PENALTY_MINUTE_OPTIONS = [2, 4, 5, 10] as const;

function isGoalie(p: PlayerData): boolean {
  return p.position === 'Goalie';
}

const fieldClass =
  'w-full rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--league-primary,#d4af37)]/50';

const labelClass =
  'block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] mb-1.5';

export function EventEditModal({
  event,
  homeRoster,
  awayRoster,
  periodCount,
  showTimePeriods,
  penaltyRules,
  isOnline,
  onSaved,
  onClose,
}: EventEditModalProps) {
  const isGoal = event.eventType === 'goal';
  const roster = event.teamType === 'home' ? homeRoster : awayRoster;
  const skaters = roster.filter((p) => !isGoalie(p));
  const rules = penaltyRules && penaltyRules.length > 0 ? penaltyRules : DEFAULT_PENALTIES;

  const [period, setPeriod] = useState<number | null>(event.period);
  const [minutes, setMinutes] = useState(
    event.gameTimeSeconds != null ? Math.floor(event.gameTimeSeconds / 60).toString() : '',
  );
  const [seconds, setSeconds] = useState(
    event.gameTimeSeconds != null ? (event.gameTimeSeconds % 60).toString().padStart(2, '0') : '',
  );

  // Goal state
  const [scorerId, setScorerId] = useState(event.playerId ?? '');
  const [assist1Id, setAssist1Id] = useState(event.assist1PlayerId ?? '');
  const [assist2Id, setAssist2Id] = useState(event.assist2PlayerId ?? '');
  const [isPowerPlay, setIsPowerPlay] = useState(event.isPowerPlay);
  const [isShortHanded, setIsShortHanded] = useState(event.isShortHanded);
  const [isEmptyNet, setIsEmptyNet] = useState(event.isEmptyNet);

  // Penalty state
  const [playerId, setPlayerId] = useState(event.playerId ?? '');
  const [penaltyType, setPenaltyType] = useState(event.penaltyType ?? rules[0]?.type ?? '');
  const [penaltyMinutes, setPenaltyMinutes] = useState(event.penaltyMinutes ?? 2);

  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (isPending) return;
    if (!isOnline) {
      setError(OFFLINE_ACTION_ERROR);
      return;
    }
    setError(null);

    let gameTimeSeconds: number | null = null;
    if (showTimePeriods) {
      const m = parseInt(minutes || '0', 10);
      const s = parseInt(seconds || '0', 10);
      if (Number.isNaN(m) || Number.isNaN(s) || s > 59 || m < 0 || s < 0) {
        setError('Enter a valid time (mm:ss).');
        return;
      }
      gameTimeSeconds = m * 60 + s;
    }

    setIsPending(true);
    try {
      const result = await updateGameEvent(
        isGoal
        ? {
            eventId: event.id,
            period: showTimePeriods ? period : null,
            gameTimeSeconds,
            scorerId,
            assist1Id: assist1Id || null,
            assist2Id: assist2Id || null,
            isPowerPlay,
            isShortHanded,
            isEmptyNet,
          }
        : {
            eventId: event.id,
            period: showTimePeriods ? period : null,
            gameTimeSeconds,
            playerId,
            penaltyType,
            penaltyMinutes,
          },
      );

      if (!result.success) {
        setError(result.error || 'Failed to save changes.');
        return;
      }
      onSaved();
    } catch {
      setError('Failed to save changes. Your edits are still here.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mx-4 mb-4 sm:mb-0 max-h-[90vh] overflow-y-auto bg-[var(--color-background)] rounded-2xl border border-[var(--color-border)] animate-in slide-in-from-bottom duration-200">
        <div className="px-4 py-3 border-b border-[var(--color-border)]">
          <h3 className="font-semibold text-[var(--color-text-primary)]">
            Edit {isGoal ? 'goal' : 'penalty'}
          </h3>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Corrections are saved to the game record
          </p>
        </div>

        <div className="p-4 space-y-4">
          {showTimePeriods && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Period</label>
                <div className="flex gap-1.5">
                  {Array.from({ length: periodCount }, (_, i) => i + 1).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPeriod(p)}
                      className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                        period === p
                          ? 'bg-[var(--league-primary,#d4af37)] text-black'
                          : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className={labelClass}>Time (mm:ss)</label>
                <div className="flex items-center gap-1">
                  <input
                    inputMode="numeric"
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    placeholder="0"
                    className={fieldClass}
                  />
                  <span className="text-[var(--color-text-secondary)]">:</span>
                  <input
                    inputMode="numeric"
                    value={seconds}
                    onChange={(e) => setSeconds(e.target.value.replace(/\D/g, '').slice(0, 2))}
                    placeholder="00"
                    className={fieldClass}
                  />
                </div>
              </div>
            </div>
          )}

          {isGoal ? (
            <>
              <div>
                <label className={labelClass}>Scorer</label>
                <select value={scorerId} onChange={(e) => setScorerId(e.target.value)} className={fieldClass}>
                  {skaters.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{p.jerseyNumber} {p.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Assist 1</label>
                  <select value={assist1Id} onChange={(e) => setAssist1Id(e.target.value)} className={fieldClass}>
                    <option value="">None</option>
                    {skaters.map((p) => (
                      <option key={p.id} value={p.id}>
                        #{p.jerseyNumber} {p.fullName}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Assist 2</label>
                  <select value={assist2Id} onChange={(e) => setAssist2Id(e.target.value)} className={fieldClass}>
                    <option value="">None</option>
                    {skaters.map((p) => (
                      <option key={p.id} value={p.id}>
                        #{p.jerseyNumber} {p.fullName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  ['PP', isPowerPlay, () => setIsPowerPlay((v) => !v)],
                  ['SH', isShortHanded, () => setIsShortHanded((v) => !v)],
                  ['EN', isEmptyNet, () => setIsEmptyNet((v) => !v)],
                ] as const).map(([label, active, toggle]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={toggle}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      active
                        ? 'bg-[var(--league-primary,#d4af37)] text-black'
                        : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <>
              <div>
                <label className={labelClass}>Player</label>
                <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} className={fieldClass}>
                  {roster.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{p.jerseyNumber} {p.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Penalty</label>
                  <select
                    value={penaltyType}
                    onChange={(e) => {
                      setPenaltyType(e.target.value);
                      const match = rules.find((r) => r.type === e.target.value);
                      if (match) setPenaltyMinutes(match.minutes);
                    }}
                    className={fieldClass}
                  >
                    {rules.map((r) => (
                      <option key={r.type} value={r.type}>
                        {r.type}
                      </option>
                    ))}
                    {penaltyType && !rules.some((r) => r.type === penaltyType) && (
                      <option value={penaltyType}>{penaltyType}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Minutes</label>
                  <select
                    value={penaltyMinutes}
                    onChange={(e) => setPenaltyMinutes(parseInt(e.target.value, 10))}
                    className={fieldClass}
                  >
                    {PENALTY_MINUTE_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m} min
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        <div className="flex gap-2 px-4 py-3 border-t border-[var(--color-border)]">
          <button
            onClick={onClose}
            disabled={isPending}
            className="flex-1 py-2.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] text-sm font-medium hover:bg-[var(--color-surface)] transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isPending || !isOnline}
            className="flex-1 py-2.5 rounded-xl bg-[var(--league-primary,#d4af37)] text-black text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
