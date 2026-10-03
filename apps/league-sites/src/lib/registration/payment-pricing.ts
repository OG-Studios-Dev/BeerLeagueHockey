import { createServiceRoleClient } from '@/lib/supabase/server';

export type PlatformFeeMode = 'pass_to_player' | 'absorb_by_league';

export interface LeaguePlatformFeeSettings {
  platformFeeBps: number;
  platformFeePercent: number;
  platformFeeMode: PlatformFeeMode;
  playerFeeSharePercent: number;
}

export interface RegistrationPaymentQuote {
  baseFeeCents: number;
  baseAmountDueCents: number;
  baseAmountPaidCents: number;
  applicationFeeCents: number;
  platformFeeCents: number;
  platformFeeOnFullFeeCents: number;
  platformFeeOnPaidBaseCents: number;
  totalChargeCents: number;
  outstandingChargeCents: number;
  totalPaidDisplayCents: number;
  platformFeeBps: number;
  platformFeePercent: number;
  platformFeeMode: PlatformFeeMode;
  chargeIncludesPlatformFee: boolean;
}

const DEFAULT_PLATFORM_FEE_SETTINGS: LeaguePlatformFeeSettings = {
  platformFeeBps: 350,
  platformFeePercent: 3.5,
  platformFeeMode: 'pass_to_player',
  playerFeeSharePercent: 100,
};

export function normalizePlatformFeeMode(value: string | null | undefined): PlatformFeeMode {
  return value === 'absorb_by_league' ? 'absorb_by_league' : 'pass_to_player';
}

export function calculatePlatformFeeCents(baseAmountCents: number, platformFeeBps: number): number {
  if (baseAmountCents <= 0 || platformFeeBps <= 0) {
    return 0;
  }

  const fee = Math.round((baseAmountCents * platformFeeBps) / 10_000);
  return Math.max(fee, 50);
}

export function buildRegistrationPaymentQuote(input: {
  baseFeeCents: number;
  baseAmountPaidCents?: number;
  platformFeeBps: number;
  platformFeeMode: PlatformFeeMode;
  playerFeeSharePercent?: number;
}): RegistrationPaymentQuote {
  const baseFeeCents = Math.max(0, input.baseFeeCents || 0);
  const baseAmountPaidCents = Math.max(0, Math.min(input.baseAmountPaidCents || 0, baseFeeCents));
  const baseAmountDueCents = Math.max(0, baseFeeCents - baseAmountPaidCents);
  const playerFeeSharePercent = input.playerFeeSharePercent ?? 100;
  const chargeIncludesPlatformFee =
    input.platformFeeMode === 'pass_to_player' && playerFeeSharePercent > 0;
  const applicationFeeCents = calculatePlatformFeeCents(baseAmountDueCents, input.platformFeeBps);
  const platformFeeOnFullFeeCents = chargeIncludesPlatformFee
    ? Math.round(calculatePlatformFeeCents(baseFeeCents, input.platformFeeBps) * playerFeeSharePercent / 100)
    : 0;
  const platformFeeOnPaidBaseCents = chargeIncludesPlatformFee
    ? Math.round(calculatePlatformFeeCents(baseAmountPaidCents, input.platformFeeBps) * playerFeeSharePercent / 100)
    : 0;
  const platformFeeCents = chargeIncludesPlatformFee
    ? Math.round(applicationFeeCents * playerFeeSharePercent / 100)
    : 0;
  const totalChargeCents = baseFeeCents + platformFeeOnFullFeeCents;
  const outstandingChargeCents = baseAmountDueCents + platformFeeCents;
  const totalPaidDisplayCents = baseAmountPaidCents + platformFeeOnPaidBaseCents;

  return {
    baseFeeCents,
    baseAmountDueCents,
    baseAmountPaidCents,
    applicationFeeCents,
    platformFeeCents,
    platformFeeOnFullFeeCents,
    platformFeeOnPaidBaseCents,
    totalChargeCents,
    outstandingChargeCents,
    totalPaidDisplayCents,
    platformFeeBps: input.platformFeeBps,
    platformFeePercent: input.platformFeeBps / 100,
    platformFeeMode: input.platformFeeMode,
    chargeIncludesPlatformFee,
  };
}

export async function getLeaguePlatformFeeSettings(
  leagueId: string
): Promise<LeaguePlatformFeeSettings> {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('league_billing_settings')
      .select('platform_fee_bps, platform_fee_mode, player_fee_share_percent')
      .eq('league_id', leagueId)
      .maybeSingle();

    if (error) {
      console.error('[Registration Pricing] Failed to load league billing settings:', error);
      return DEFAULT_PLATFORM_FEE_SETTINGS;
    }

    const platformFeeBps =
      typeof data?.platform_fee_bps === 'number' && data.platform_fee_bps >= 0
        ? data.platform_fee_bps
        : DEFAULT_PLATFORM_FEE_SETTINGS.platformFeeBps;

    return {
      platformFeeBps,
      platformFeePercent: platformFeeBps / 100,
      platformFeeMode: normalizePlatformFeeMode(data?.platform_fee_mode),
      playerFeeSharePercent: (data as any)?.player_fee_share_percent ?? 100,
    };
  } catch (error) {
    console.error('[Registration Pricing] Unexpected billing settings error:', error);
    return DEFAULT_PLATFORM_FEE_SETTINGS;
  }
}

export async function getRegistrationPaymentQuoteForLeague(
  leagueId: string,
  baseFeeCents: number,
  baseAmountPaidCents = 0
): Promise<RegistrationPaymentQuote> {
  const settings = await getLeaguePlatformFeeSettings(leagueId);
  return buildRegistrationPaymentQuote({
    baseFeeCents,
    baseAmountPaidCents,
    platformFeeBps: settings.platformFeeBps,
    platformFeeMode: settings.platformFeeMode,
    playerFeeSharePercent: settings.playerFeeSharePercent,
  });
}
