'use client';

import { signUp } from '@/lib/actions/auth';
import { searchClaimablePlayerProfiles, type ClaimablePlayerCandidate } from '@/lib/actions/legacy-merge';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useState } from 'react';
import { cn } from '@hockey-life/ui/lib/utils';
import { Loader2, Search, UserCheck, X } from 'lucide-react';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { OAuthProviderButton } from '@/components/auth/OAuthProviderButton';
import { validatedAuthLocale } from '@/lib/auth/oauth-redirect';

export default function SignupPage() {
  const t = useTranslations();
  const locale = validatedAuthLocale(useLocale());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [playerSearch, setPlayerSearch] = useState('');
  const [playerSearchLoading, setPlayerSearchLoading] = useState(false);
  const [playerCandidates, setPlayerCandidates] = useState<ClaimablePlayerCandidate[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<ClaimablePlayerCandidate | null>(null);

  async function handlePlayerSearch() {
    const query = playerSearch.trim();
    if (query.length < 2) {
      setPlayerCandidates([]);
      return;
    }

    setError(null);
    setPlayerSearchLoading(true);
    try {
      const result = await searchClaimablePlayerProfiles(query);
      if (result.success) {
        setPlayerCandidates(result.data);
      } else {
        setError(result.error);
      }
    } catch {
      setError(t('errors.generic'));
    } finally {
      setPlayerSearchLoading(false);
    }
  }

  async function handleSubmit(formData: FormData) {
    setError(null);
    setLoading(true);

    try {
      const result = await signUp(formData);
      if (result?.error) {
        setError(result.error);
      }
    } catch (error) {
      if (isRedirectError(error)) {
        throw error;
      }
      setError(t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  const inputClasses = cn(
    'w-full px-4 py-3 rounded-xl',
    'bg-neutral-800 border border-neutral-700',
    'text-white placeholder:text-neutral-500',
    'focus:outline-none focus:ring-2 focus:ring-rink-500 focus:border-transparent',
    'transition-[border-color,box-shadow]'
  );

  return (
    <div className="bg-white/[0.04] border border-white/10 backdrop-blur-xl rounded-2xl p-8">
      <h2 className="text-2xl font-bold text-white mb-2">
        {t('auth.createAccount')}
      </h2>
      <p className="text-sm text-neutral-400 mb-6">
        {t('navigation.createLeague')}
      </p>

      {/* OAuth Providers */}
      <div className="space-y-3">
        <OAuthProviderButton
          provider="google"
          label={t('auth.signUpWithGoogle')}
          locale={locale}
        />
        <OAuthProviderButton
          provider="apple"
          label={t('auth.signUpWithApple')}
          locale={locale}
        />
      </div>

      {/* Divider */}
      <div className="relative my-6">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-neutral-700" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-neutral-900 px-3 text-neutral-500">
            {t('auth.orContinueWithEmail')}
          </span>
        </div>
      </div>

      <form action={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="fullName"
            className="block text-sm font-medium text-neutral-300 mb-2"
          >
            {t('auth.fullName')}
          </label>
          <input
            type="text"
            id="fullName"
            name="fullName"
            required
            autoComplete="name"
            className={inputClasses}
            placeholder={t('auth.fullNamePlaceholder')}
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-neutral-300 mb-2"
          >
            {t('auth.email')}
          </label>
          <input
            type="email"
            id="email"
            name="email"
            required
            autoComplete="email"
            spellCheck={false}
            className={inputClasses}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-neutral-300 mb-2"
          >
            {t('auth.password')}
          </label>
          <input
            type="password"
            id="password"
            name="password"
            required
            minLength={8}
            autoComplete="new-password"
            className={inputClasses}
            placeholder="••••••••"
          />
          <div className="text-xs text-neutral-500 mt-1.5 space-y-0.5">
            <p className="font-medium text-neutral-400">{t('auth.passwordMustContain')}</p>
            <ul className="list-disc list-inside ml-1 space-y-0.5">
              <li>{t('auth.passwordRuleLength')}</li>
              <li>{t('auth.passwordRuleUppercase')}</li>
              <li>{t('auth.passwordRuleLowercase')}</li>
              <li>{t('auth.passwordRuleNumber')}</li>
              <li>{t('auth.passwordRuleSpecial')}</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-neutral-700 pt-4 space-y-3">
          <div>
            <label
              htmlFor="playerSearch"
              className="block text-sm font-medium text-neutral-300 mb-2"
            >
              {t('auth.requestPlayerHistoryReview', { defaultValue: 'Request player history review' })} <span className="text-neutral-500 font-normal">({t('common.optional', { defaultValue: 'optional' })})</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                id="playerSearch"
                value={playerSearch}
                onChange={(e) => setPlayerSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handlePlayerSearch();
                  }
                }}
                className={inputClasses}
                placeholder="Search your player name or email"
              />
              <button
                type="button"
                onClick={handlePlayerSearch}
                disabled={playerSearchLoading || playerSearch.trim().length < 2}
                className="px-4 rounded-xl bg-white/[0.08] border border-white/10 text-neutral-200 hover:bg-white/[0.12] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                aria-label="Search player history"
              >
                {playerSearchLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-neutral-500 mt-1.5">
              {t('auth.playerHistoryReviewDescription', { defaultValue: 'Already on a roster? Select a possible match for platform-admin review. Your account will be created now; no history moves until approval.' })}
            </p>
          </div>

          {selectedPlayer && (
            <div className="rounded-xl border border-rink-500/30 bg-rink-500/10 p-3 flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-rink-400" />
                  {t('auth.playerHistoryPendingFor', { defaultValue: 'Requesting review for {name}', name: selectedPlayer.fullName })}
                </p>
                <p className="text-xs text-neutral-400 mt-1">
                  {selectedPlayer.teams[0]?.teamName || 'Rostered player'} · {selectedPlayer.stats.points} PTS · {selectedPlayer.stats.gamesPlayed} GP
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPlayer(null)}
                className="text-neutral-400 hover:text-white"
                aria-label="Clear selected player history"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {!selectedPlayer && playerCandidates.length > 0 && (
            <div className="space-y-2">
              {playerCandidates.map((candidate) => (
                <button
                  type="button"
                  key={candidate.id}
                  onClick={() => setSelectedPlayer(candidate)}
                  className="w-full text-left rounded-xl border border-white/10 bg-white/[0.04] p-3 hover:border-rink-500/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{candidate.fullName}</p>
                      <p className="text-xs text-neutral-500">
                        {candidate.emailHint ? `${candidate.emailHint} · ` : ''}
                        {candidate.teams[0]?.teamName || 'Rostered player'}
                        {candidate.teams[0]?.seasonName ? ` · ${candidate.teams[0].seasonName}` : ''}
                      </p>
                    </div>
                    <div className="text-right text-xs text-neutral-400 shrink-0">
                      <p>{candidate.stats.gamesPlayed} GP</p>
                      <p>{candidate.stats.points} PTS</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!selectedPlayer && playerSearch.trim().length >= 2 && !playerSearchLoading && playerCandidates.length === 0 && (
            <p className="text-xs text-neutral-500">{t('auth.noPlayerHistorySelected', { defaultValue: 'No player history review selected.' })}</p>
          )}

          <input type="hidden" name="claimPlayerProfileId" value={selectedPlayer?.id || ''} />
        </div>

        <div className="border-t border-neutral-700 pt-4">
          <label
            htmlFor="organizationName"
            className="block text-sm font-medium text-neutral-300 mb-2"
          >
            {selectedPlayer ? t('auth.leagueTeamName', { defaultValue: 'League / team name' }) : t('auth.companyName')} {selectedPlayer && <span className="text-neutral-500 font-normal">({t('common.optional', { defaultValue: 'optional' })})</span>}
          </label>
          <input
            type="text"
            id="organizationName"
            name="organizationName"
            required={!selectedPlayer}
            autoComplete="organization"
            className={inputClasses}
            placeholder={t('auth.companyNamePlaceholder')}
          />
          <p className="text-xs text-neutral-500 mt-1">
            {selectedPlayer
              ? t('auth.pendingReviewAccountDescription', { defaultValue: 'Your player account is created independently while the selected history remains pending admin review.' })
              : t('auth.companyNameDescription')}
          </p>
          {!selectedPlayer && (
            <p className="text-xs text-neutral-600 mt-0.5">
              {t('auth.companyNameExample')}
            </p>
          )}
        </div>

        <div className="border-t border-neutral-700 pt-4 space-y-3">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              id="acceptTerms"
              name="acceptTerms"
              value="true"
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-neutral-600 bg-neutral-800 text-rink-500 focus:ring-rink-500 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-sm text-neutral-300 group-hover:text-neutral-200">
              {t.rich('auth.acceptTerms', {
                link: (chunks) => (
                  <Link href="/terms" target="_blank" className="text-rink-500 hover:text-rink-400 underline" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                    {chunks}
                  </Link>
                ),
              })}{' '}
              <span className="text-red-400">*</span>
            </span>
          </label>

          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="checkbox"
              id="acceptPrivacy"
              name="acceptPrivacy"
              value="true"
              checked={acceptedPrivacy}
              onChange={(e) => setAcceptedPrivacy(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-neutral-600 bg-neutral-800 text-rink-500 focus:ring-rink-500 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-sm text-neutral-300 group-hover:text-neutral-200">
              {t.rich('auth.acceptPrivacy', {
                link: (chunks) => (
                  <Link href="/privacy" target="_blank" className="text-rink-500 hover:text-rink-400 underline" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                    {chunks}
                  </Link>
                ),
              })}{' '}
              <span className="text-red-400">*</span>
            </span>
          </label>

          <p className="text-xs text-neutral-500">
            <span className="text-red-400">*</span> {t('auth.requiredField')}
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3" aria-live="polite">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !acceptedTerms || !acceptedPrivacy}
          className={cn(
            'w-full py-3 px-4 rounded-xl font-semibold text-sm',
            'bg-gradient-to-r from-rink-500 to-arena-500 text-black',
            'hover:shadow-lg hover:shadow-rink-500/20',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            'transition-[box-shadow,opacity] flex items-center justify-center gap-2'
          )}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('common.loading')}
            </>
          ) : (
            t('auth.signup')
          )}
        </button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-sm text-neutral-400">
          {t('auth.alreadyHaveAccount')}{' '}
          <Link
            href="/login"
            className="text-rink-500 hover:text-rink-400 font-medium"
          >
            {t('auth.loginNow')}
          </Link>
        </p>
      </div>
    </div>
  );
}
