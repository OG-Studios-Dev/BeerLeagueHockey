'use client';

import type { UseGameTimerReturn } from '@/hooks/useGameTimer';

interface GameTimerProps {
  timer: UseGameTimerReturn;
  periodCount: number;
  disabled?: boolean;
}

export function GameTimer({ timer, periodCount, disabled = false }: GameTimerProps) {
  const periodLabel = timer.isOvertime
    ? 'OT'
    : `P${timer.currentPeriod}`;

  return (
    <div className="flex items-center gap-4">
      {/* Period Indicator */}
      <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]">
        <span className="text-sm font-bold text-[var(--color-text-primary)]">
          {periodLabel}
        </span>
      </div>

      {/* Timer Display */}
      <div className="flex-1 text-center">
        <div className="flex items-center justify-center gap-2">
          {timer.isRunning && (
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />
          )}
          <span className="text-4xl font-mono font-bold tabular-nums tracking-wider text-[var(--color-text-primary)]">
            {timer.formattedTime}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {!timer.periodEnded ? (
          <>
            {/* Start/Stop */}
            <button
              onClick={() => {
                if (!disabled) (timer.isRunning ? timer.stop : timer.start)();
              }}
              disabled={disabled}
              className={`
                flex items-center justify-center w-12 h-12 rounded-xl
                transition-all duration-200 active:scale-95
                ${timer.isRunning
                  ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
                  : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
                }
              `}
              aria-label={timer.isRunning ? 'Stop timer' : 'Start timer'}
            >
              {timer.isRunning ? (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5.14v14l11-7-11-7z" />
                </svg>
              )}
            </button>

            {/* End Period */}
            <button
              onClick={() => {
                if (!disabled) timer.endPeriod();
              }}
              disabled={disabled}
              className="flex items-center justify-center w-12 h-12 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-border-emphasis)] transition-all duration-200 active:scale-95"
              aria-label="End period"
              title="End period"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.406 1.683-.977l7.108 4.061a1.125 1.125 0 010 1.954l-7.108 4.061a1.125 1.125 0 01-1.683-.977V8.69z" />
              </svg>
            </button>
          </>
        ) : (
          /* Next Period */
          <button
            onClick={() => {
              if (!disabled) timer.startPeriod(timer.currentPeriod + 1);
            }}
            disabled={disabled}
            className="px-4 py-2.5 rounded-xl bg-[var(--league-primary,#d4af37)] text-[var(--color-accent-text,#000)] font-semibold text-sm transition-all duration-200 hover:opacity-90 active:scale-95"
          >
            {timer.currentPeriod >= periodCount ? 'Start OT' : `Start P${timer.currentPeriod + 1}`}
          </button>
        )}
      </div>
    </div>
  );
}
