'use client';

import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { cn } from '@hockey-life/ui/lib/utils';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { UserIdentity } from '@supabase/supabase-js';
import { useSearchParams } from 'next/navigation';
import { oauthRecoveryCode } from '@/lib/auth/oauth-errors';

type OAuthProvider = 'google' | 'apple';

const LINKABLE_PROVIDERS: { id: OAuthProvider; name: string }[] = [
  { id: 'google', name: 'Google' },
  { id: 'apple', name: 'Apple' },
];

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

const PROVIDER_ICONS: Record<OAuthProvider, React.FC<{ className?: string }>> = {
  google: GoogleIcon,
  apple: AppleIcon,
};

export function LinkedAccountsSection() {
  const t = useTranslations('orgSettings.linkedAccounts');
  const searchParams = useSearchParams();
  const [identities, setIdentities] = useState<UserIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkingProvider, setLinkingProvider] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const oauthError = oauthRecoveryCode(searchParams.get('oauth_error'));
  const callbackError = oauthError === 'consent_canceled'
    ? t('consentCanceled')
    : oauthError === 'identity_conflict'
      ? t('identityConflict')
      : oauthError === 'oauth_failed'
        ? t('oauthFailed')
        : null;

  const fetchIdentities = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.auth.getUserIdentities();
    if (error) {
      setError(t('loadFailed'));
    } else {
      setIdentities(data.identities);
    }
    setLoading(false);
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchIdentities();
  }, [fetchIdentities]);

  const isLinked = (provider: OAuthProvider) =>
    identities.some((i) => i.provider === provider);

  async function handleLink(provider: OAuthProvider) {
    setLinkingProvider(provider);
    setError(null);

    const supabase = createClient();
    const origin = process.env.NEXT_PUBLIC_APP_URL || window.location.origin;
    const callbackUrl = new URL('/api/auth/callback', origin);
    callbackUrl.searchParams.set('next', window.location.pathname);
    callbackUrl.searchParams.set('flow', 'link');

    const { error } = await supabase.auth.linkIdentity({
      provider,
      options: {
        redirectTo: callbackUrl.toString(),
      },
    });

    if (error) {
      setError(t('oauthFailed'));
      setLinkingProvider(null);
    }
    // If no error, browser redirects to the provider
  }

  async function handleUnlink(identity: UserIdentity) {
    // Prevent unlinking the last identity
    if (identities.length <= 1) {
      setError(t('cannotUnlinkLast'));
      return;
    }

    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.unlinkIdentity(identity);

    if (error) {
      setError(t('unlinkFailed'));
    } else {
      setIdentities((prev) => prev.filter((i) => i.id !== identity.id));
    }
  }

  if (loading) {
    return (
      <section>
        <div className="mb-6">
          <h2 className="text-xl font-bold text-white">{t('title')}</h2>
          <p className="text-sm text-neutral-400 mt-1">{t('description')}</p>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-neutral-400" />
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-6">
        <h2 className="text-xl font-bold text-white">{t('title')}</h2>
        <p className="text-sm text-neutral-400 mt-1">{t('description')}</p>
      </div>

      <div className="space-y-3">
        {LINKABLE_PROVIDERS.map(({ id, name }) => {
          const linked = isLinked(id);
          const identity = identities.find((i) => i.provider === id);
          const Icon = PROVIDER_ICONS[id];
          const isLinking = linkingProvider === id;

          return (
            <div
              key={id}
              className={cn(
                'flex items-center justify-between p-4 rounded-xl border',
                linked
                  ? 'bg-emerald-500/5 border-emerald-500/20'
                  : 'bg-white/[0.04] border-white/10'
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white/[0.08] flex items-center justify-center">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-medium text-white">{name}</p>
                  {linked && identity?.identity_data?.email ? (
                    <p className="text-xs text-neutral-400">
                      {identity.identity_data.email as string}
                    </p>
                  ) : (
                    <p className="text-xs text-neutral-500">{t('notConnected')}</p>
                  )}
                </div>
              </div>

              {linked ? (
                <button
                  onClick={() => identity && handleUnlink(identity)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                    'text-neutral-400 border border-white/10 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/5'
                  )}
                >
                  {t('unlink')}
                </button>
              ) : (
                <button
                  onClick={() => handleLink(id)}
                  disabled={isLinking}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                    'text-rink-500 border border-rink-500/30 hover:bg-rink-500/10',
                    'disabled:opacity-50 disabled:cursor-not-allowed'
                  )}
                >
                  {isLinking ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    t('link')
                  )}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {(error || callbackError) && (
        <p className="text-sm text-red-400 mt-3" aria-live="polite">
          {error || callbackError}
        </p>
      )}
    </section>
  );
}
