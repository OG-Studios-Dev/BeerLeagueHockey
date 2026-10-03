'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, BarChart3, TrendingUp, Target, Trophy, Zap, Users, Percent, Flame } from 'lucide-react';

interface PointInsight {
  key: string;
  label: string;
  text: string;
}

const ICON_MAP: Record<string, typeof BarChart3> = {
  ppg: TrendingUp,
  pace: Zap,
  rank: Trophy,
  streak: Flame,
  goal_diff: Target,
  roster_depth: Users,
  win_pct: Percent,
};

function InsightIcon({ insightKey, className }: { insightKey: string; className?: string }) {
  const Icon = ICON_MAP[insightKey] || BarChart3;
  return <Icon className={className} />;
}

export function PointInsightsCarousel({ insights, asBanner = false }: { insights: PointInsight[]; asBanner?: boolean }) {
  const [index, setIndex] = useState(0);

  const next = useCallback(() => {
    setIndex((i) => (i + 1) % insights.length);
  }, [insights.length]);

  const prev = useCallback(() => {
    setIndex((i) => (i - 1 + insights.length) % insights.length);
  }, [insights.length]);

  useEffect(() => {
    if (insights.length <= 1) return;
    const timer = setInterval(next, 6000);
    return () => clearInterval(timer);
  }, [next, insights.length]);

  if (insights.length === 0) return null;

  const insight = insights[index];

  return (
    <div className={asBanner ? 'mt-6' : 'mt-8 border-t border-[var(--color-border)]/50 pt-6'}>
      {!asBanner && (
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-[var(--league-primary)]" />
          <h3 className="text-lg font-bold tracking-tight text-[var(--color-text-primary)]">Points Insights</h3>
        </div>
      )}

      <div className={`relative rounded-[22px] p-5 ${
        asBanner
          ? 'border border-[var(--league-primary)]/20 bg-[var(--league-primary)]/[0.06]'
          : 'glass-card'
      }`}>
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--league-primary)]/12">
            <InsightIcon insightKey={insight.key} className="h-5 w-5 text-[var(--league-primary)]" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--league-primary)]">
              {insight.label}
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">{insight.text}</p>
          </div>
        </div>

        {insights.length > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={prev}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/25 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--league-primary)]"
              aria-label="Previous insight"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-1.5">
              {insights.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === index ? 'w-4 bg-[var(--league-primary)]' : 'w-1.5 bg-white/20'
                  }`}
                />
              ))}
            </div>
            <button
              onClick={next}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/25 text-[var(--color-text-secondary)] transition-colors hover:text-[var(--league-primary)]"
              aria-label="Next insight"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
