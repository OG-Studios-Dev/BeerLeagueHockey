'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  getLegacyCandidates,
} from '@/lib/actions/legacy-merge';
import type { LegacyCandidate } from '@/lib/actions/legacy-merge';
import { cn } from '@hockey-life/ui';
import { History, ShieldCheck, ArrowRight } from 'lucide-react';

interface ClaimHistoryClientProps {
  locale: string;
}

export function ClaimHistoryClient({ locale }: ClaimHistoryClientProps) {
  const router = useRouter();
  const t = useTranslations();

  const [candidates, setCandidates] = useState<LegacyCandidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const result = await getLegacyCandidates();
      if (result.success) {
        if (result.data.length === 0) {
          router.replace(`/${locale}/dashboard`);
          return;
        }
        setCandidates(result.data);
      } else {
        setError(result.error);
      }
      setLoading(false);
    }
    load();
  }, [locale, router]);

  // Skeleton loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-neutral-950">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          {/* Header skeleton */}
          <div className="text-center mb-10">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/[0.04] animate-pulse" />
            <div className="h-8 w-72 mx-auto bg-white/[0.04] rounded-lg animate-pulse mb-3" />
            <div className="h-5 w-96 mx-auto bg-white/[0.04] rounded-lg animate-pulse" />
          </div>
          {/* Card skeletons */}
          <div className="grid gap-6 md:grid-cols-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white/[0.04] border border-white/10 rounded-2xl p-6 animate-pulse"
              >
                <div className="h-6 w-40 bg-white/[0.06] rounded mb-4" />
                <div className="flex gap-2 mb-4">
                  <div className="h-6 w-24 bg-white/[0.06] rounded-full" />
                  <div className="h-6 w-28 bg-white/[0.06] rounded-full" />
                </div>
                <div className="grid grid-cols-4 gap-3 mb-5">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j} className="h-12 bg-white/[0.06] rounded-lg" />
                  ))}
                </div>
                <div className="h-10 bg-white/[0.06] rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-rink-500/10 flex items-center justify-center">
            <History className="w-8 h-8 text-rink-500" />
          </div>
          <h1 className="text-3xl font-black text-white tracking-tight mb-2">
            {t('claimHistory.title', { defaultValue: 'Player history review pending' })}
          </h1>
          <p className="text-neutral-400 max-w-lg mx-auto">
            {t('claimHistory.subtitle', {
              defaultValue:
                'These possible matches remain unchanged until a platform administrator verifies and approves your request.',
            })}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        {/* Candidate Cards */}
        <div className="grid gap-6 md:grid-cols-2">
          {candidates.map((candidate) => (
            <div
              key={candidate.id}
              className={cn(
                'bg-white/[0.04] border border-white/10 backdrop-blur-xl rounded-2xl p-6',
                'hover:border-rink-500/30 transition-all duration-200',
                'border-rink-500/20'
              )}
            >
              {/* Player Name */}
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-rink-500/10 flex items-center justify-center text-rink-500 font-bold text-sm">
                  {candidate.fullName
                    .split(' ')
                    .map((n) => n[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </div>
                <h3 className="text-lg font-bold text-white">{candidate.fullName}</h3>
              </div>

              {/* Teams */}
              {candidate.teams.length > 0 && (
                <div className="mb-4">
                  <p className="text-xs text-neutral-500 uppercase tracking-wider mb-2">
                    {t('claimHistory.teamsPlayed', { defaultValue: 'Teams' })}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {candidate.teams.map((team, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/[0.06] text-neutral-300 border border-white/[0.08]"
                      >
                        {team.teamName}
                        <span className="mx-1 text-neutral-600">·</span>
                        <span className="text-neutral-500">{team.seasonName}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Stats Row */}
              <div className="grid grid-cols-4 gap-2 mb-5">
                {[
                  { label: 'GP', value: candidate.stats.gamesPlayed },
                  { label: 'G', value: candidate.stats.goals },
                  { label: 'A', value: candidate.stats.assists },
                  { label: 'PTS', value: candidate.stats.points },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="bg-white/[0.04] rounded-lg p-2 text-center"
                  >
                    <p className="text-xs text-neutral-500 mb-0.5">{stat.label}</p>
                    <p className="text-lg font-bold text-white">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm bg-amber-500/10 border border-amber-500/20 text-amber-200">
                <ShieldCheck className="w-4 h-4" />
                {t('claimHistory.pendingApproval', { defaultValue: 'Pending admin approval' })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer Actions */}
        <div className="mt-10 flex items-center justify-center">
          <button
            onClick={() => router.push(`/${locale}/dashboard`)}
            className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-50"
          >
            {t('claimHistory.continue', { defaultValue: 'Continue to dashboard' })}
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
