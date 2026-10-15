import { notFound } from 'next/navigation';
import { getLeagueBySlug, getLeagueTheme, getTickerGames, getDivisions, getSeasons, getLeagueSponsors, hasPlatformSubscription } from '@/lib/data';
import { LeagueHeader } from '@/components/LeagueHeader';
import { LeagueThemeProvider } from '@/components/LeagueThemeProvider';
import { PreviewModeProvider } from '@/components/PreviewModeProvider';
import { AuthProvider } from '@/components/auth';
import { PremiumScoreTicker } from '@/components/PremiumScoreTicker';
import { DivisionFilterProvider } from '@/components/DivisionFilterProvider';
import { SponsorFooterStrip } from '@/components/sponsors/SponsorFooterStrip';
import { BugReportProvider } from '@/components/bug-report/BugReportProvider';
import { SubscriptionProvider } from '@/components/shared';
import type { Metadata } from 'next';
import { LeagueSiteAnalytics } from '@/components/LeagueSiteAnalytics';
import { FloatingDock } from '@/components/FloatingDock';
import { ScrollRevealObserver } from '@/components/ScrollRevealObserver';
import { pickRegistrationSeason } from '@/lib/registration/seasons';
import { pickOperationalSeason } from '@/lib/seasons/operational';
import { CheckinReminderBanner } from '@/components/checkin/CheckinReminderBanner';
import { OneTimeAppSetupPrompt } from '@/components/pwa/AppSetupActions';
import { shouldShowPublicSponsors } from '@/lib/publicSiteVisibility';

/**
 * Force league routes dynamic.
 *
 * These routes depend on no-store Supabase reads in shared layout/metadata code,
 * and Vercel production has been surfacing DYNAMIC_SERVER_USAGE on statically
 * treated league pages. Stats/player detail routes already opt into dynamic
 * rendering and were not failing in the same way.
 */
export const dynamic = 'force-dynamic';

/**
 * Revalidate every 60 seconds as a time-based fallback.
 * On-demand revalidation is handled via /api/revalidate endpoint.
 */
export const revalidate = 60;

interface LeagueLayoutProps {
  children: React.ReactNode;
  params: Promise<{ leagueSlug: string }>;
}

/**
 * Generate metadata for the league
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ leagueSlug: string }>;
}): Promise<Metadata> {
  const { leagueSlug } = await params;
  const league = await getLeagueBySlug(leagueSlug);

  if (!league) {
    return {
      title: 'League Not Found',
    };
  }

  const iconUrl = (league as any).favicon_url || league.logo_url;

  return {
    title: {
      default: league.name,
      template: `%s | ${league.name}`,
    },
    description: league.description || `${league.name} - Powered by Beer League Hockey`,
    ...(iconUrl && {
      icons: {
        icon: [
          { url: iconUrl, sizes: '32x32' },
          { url: iconUrl, sizes: '16x16' },
        ],
        apple: iconUrl,
        shortcut: iconUrl,
      },
    }),
    manifest: `/${leagueSlug}/manifest.webmanifest`,
    openGraph: {
      title: league.name,
      description: league.description || `${league.name} - Powered by Beer League Hockey`,
      images: league.banner_url ? [{ url: league.banner_url }] : [],
    },
  };
}

/**
 * League layout with header, footer, and theme provider
 */
export default async function LeagueLayout({ children, params }: LeagueLayoutProps) {
  const { leagueSlug } = await params;
  const league = await getLeagueBySlug(leagueSlug);

  if (!league) {
    notFound();
  }

  const showPublicSponsors = shouldShowPublicSponsors(leagueSlug);
  const [theme, divisions, seasons, sponsors, isSubscribed] = await Promise.all([
    Promise.resolve(getLeagueTheme(league)),
    getDivisions(league.id),
    getSeasons(league.id),
    showPublicSponsors ? getLeagueSponsors(league.id) : Promise.resolve([]),
    hasPlatformSubscription(league.id),
  ]);
  const templateClass = `league-template-${theme.templateVariant}`;

  // Check if any season has open registration
  const registrationSeason = pickRegistrationSeason(seasons as any[]);
  const registrationOpen = Boolean(registrationSeason);
  const operationalSeason = pickOperationalSeason(seasons as any[]);
  const activeSeasonId = (operationalSeason as any)?.id ?? null;
  const isPlayoffSeason = (operationalSeason as any)?.status === 'playoffs';
  const tickerGames = activeSeasonId ? await getTickerGames(league.id, 10, activeSeasonId) : [];

  return (
    <LeagueThemeProvider theme={theme}>
      <AuthProvider>
        <PreviewModeProvider>
          <BugReportProvider leagueId={league.id} seasonId={activeSeasonId}>
            <SubscriptionProvider isSubscribed={isSubscribed}>
              <DivisionFilterProvider divisions={divisions} leagueId={league.id}>
                <div className={`relative z-[1] min-h-screen flex flex-col overflow-x-clip ${templateClass}`}>
                  {league.banner_url && (
                    <div className="pointer-events-none absolute inset-0 overflow-hidden">
                      <div
                        className="absolute inset-0"
                        style={{
                          backgroundImage: `url(${league.banner_url})`,
                          backgroundPosition: 'center top',
                          backgroundRepeat: 'no-repeat',
                          backgroundSize: 'cover',
                          opacity: 0.06,
                        }}
                      />
                      <div className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-background)_92%,transparent)_0%,color-mix(in_srgb,var(--color-background)_98%,transparent)_30%,var(--color-background)_100%)]" />
                    </div>
                  )}
                  {(league as any).settings?.website?.showGameTicker !== false && tickerGames.length > 0 && (
                    <div className="league-site-chrome">
                      <PremiumScoreTicker games={tickerGames} leagueSlug={leagueSlug} timezone={league.timezone} />
                    </div>
                  )}
                  <div className="league-site-chrome">
                    <LeagueHeader
                      league={league}
                      leagueSlug={leagueSlug}
                      registrationOpen={registrationOpen}
                      registrationSeasonId={(registrationSeason as any)?.id ?? null}
                      visiblePages={(league as any).settings?.website?.visiblePages}
                      isPlayoffSeason={isPlayoffSeason}
                    />
                  </div>
                  <CheckinReminderBanner leagueId={league.id} leagueSlug={leagueSlug} seasonId={activeSeasonId} />
                  <LeagueSiteAnalytics leagueSlug={leagueSlug} />
                  <main className="league-site-main flex-1">
                    <ScrollRevealObserver />
                    {children}
                  </main>
                  <OneTimeAppSetupPrompt leagueName={league.name} leagueSlug={leagueSlug} />
                  {showPublicSponsors && (
                    <div className="league-site-chrome">
                      <SponsorFooterStrip sponsors={sponsors} />
                    </div>
                  )}
                  <FloatingDock
                    leagueId={league.id}
                    leagueSlug={leagueSlug}
                    leagueName={league.name}
                    leagueLogoUrl={league.logo_url}
                    seasonId={activeSeasonId}
                    visiblePages={(league as any).settings?.website?.visiblePages}
                    customNavItems={(league as any).settings?.website?.navItems}
                    isPlayoffSeason={isPlayoffSeason}
                    registrationOpen={registrationOpen}
                  />
                </div>
              </DivisionFilterProvider>
            </SubscriptionProvider>
          </BugReportProvider>
        </PreviewModeProvider>
      </AuthProvider>
    </LeagueThemeProvider>
  );
}
