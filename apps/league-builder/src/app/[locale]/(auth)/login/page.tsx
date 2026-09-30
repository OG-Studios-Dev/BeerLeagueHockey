'use client';

import { signIn } from '@/lib/actions/auth';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { cn } from '@hockey-life/ui/lib/utils';
import { Loader2 } from 'lucide-react';
import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { posthog } from '@/lib/posthog-client';
import { OAuthProviderButton } from '@/components/auth/OAuthProviderButton';
import { oauthRecoveryCode } from '@/lib/auth/oauth-errors';

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="bg-white/[0.04] border border-white/10 backdrop-blur-xl rounded-2xl p-8 animate-pulse">
        <div className="h-8 bg-neutral-800 rounded w-48 mb-2" />
        <div className="h-4 bg-neutral-800 rounded w-64 mb-6" />
        <div className="space-y-4">
          <div className="h-12 bg-neutral-800 rounded-xl" />
          <div className="h-12 bg-neutral-800 rounded-xl" />
          <div className="h-12 bg-neutral-800 rounded-xl" />
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const t = useTranslations();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const redirectTo = searchParams.get('redirect');
  const oauthError = oauthRecoveryCode(searchParams.get('oauth_error'));
  const oauthErrorMessage = oauthError === 'consent_canceled'
    ? t('auth.oauthConsentCanceled')
    : oauthError === 'identity_conflict'
      ? t('auth.oauthIdentityConflict')
      : oauthError === 'oauth_failed'
        ? t('auth.oauthFailed')
        : null;

  async function handleSubmit(formData: FormData) {
    setError(null);
    setWarning(null);
    setLoading(true);

    try {
      const result = await signIn(formData);
      if (result?.error) {
        setError(result.error);

        // Show remaining attempts warning if close to lockout
        if (result.remainingAttempts !== undefined && result.remainingAttempts <= 2 && result.remainingAttempts > 0) {
          setWarning(t('auth.attemptsRemaining', { count: result.remainingAttempts }));
        }
      }
    } catch (error) {
      if (isRedirectError(error)) {
        posthog.capture('user_logged_in');
        throw error;
      }
      setError(t('errors.generic'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white/[0.04] border border-white/10 backdrop-blur-xl rounded-2xl p-8">
      <h2 className="text-2xl font-bold text-white mb-2">
        {t('auth.welcomeBack')}
      </h2>
      <p className="text-sm text-neutral-400 mb-6">
        {t('auth.enterEmail')}
      </p>

      {oauthErrorMessage && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-6" aria-live="polite">
          <p className="text-sm text-red-400">{oauthErrorMessage}</p>
        </div>
      )}

      {/* OAuth Providers */}
      <div className="space-y-3">
        <OAuthProviderButton
          provider="google"
          label={t('auth.continueWithGoogle')}
          redirectTo={redirectTo || undefined}
        />
        <OAuthProviderButton
          provider="apple"
          label={t('auth.continueWithApple')}
          redirectTo={redirectTo || undefined}
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
        {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
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
            className={cn(
              'w-full px-4 py-3 rounded-xl',
              'bg-neutral-800 border border-neutral-700',
              'text-white placeholder:text-neutral-500',
              'focus:outline-none focus:ring-2 focus:ring-rink-500 focus:border-transparent',
              'transition-[border-color,box-shadow]'
            )}
            placeholder="you@example.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label
              htmlFor="password"
              className="block text-sm font-medium text-neutral-300"
            >
              {t('auth.password')}
            </label>
            <Link
              href="/forgot-password"
              className="text-xs text-rink-500 hover:text-rink-400"
            >
              {t('auth.forgotPassword')}
            </Link>
          </div>
          <input
            type="password"
            id="password"
            name="password"
            required
            autoComplete="current-password"
            className={cn(
              'w-full px-4 py-3 rounded-xl',
              'bg-neutral-800 border border-neutral-700',
              'text-white placeholder:text-neutral-500',
              'focus:outline-none focus:ring-2 focus:ring-rink-500 focus:border-transparent',
              'transition-[border-color,box-shadow]'
            )}
            placeholder="********"
          />
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3" aria-live="polite">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {warning && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3" aria-live="polite">
            <p className="text-sm text-amber-400">{warning}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
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
            t('auth.login')
          )}
        </button>
      </form>

      <div className="mt-6 text-center">
        <p className="text-sm text-neutral-400">
          {t('auth.dontHaveAccount')}{' '}
          <Link
            href="/signup"
            className="text-rink-500 hover:text-rink-400 font-medium"
          >
            {t('auth.signUpNow')}
          </Link>
        </p>
      </div>
    </div>
  );
}
