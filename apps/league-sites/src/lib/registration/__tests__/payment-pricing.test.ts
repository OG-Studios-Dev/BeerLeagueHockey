import { describe, expect, it } from '@jest/globals';
import {
  buildRegistrationPaymentQuote,
  calculatePlatformFeeCents,
} from '@/lib/registration/payment-pricing';

describe('registration payment pricing', () => {
  it('adds the platform fee to the player total when the league passes it through', () => {
    const quote = buildRegistrationPaymentQuote({
      baseFeeCents: 50_000,
      baseAmountPaidCents: 0,
      platformFeeBps: 300,
      platformFeeMode: 'pass_to_player',
    });

    expect(quote.applicationFeeCents).toBe(1_500);
    expect(quote.platformFeeCents).toBe(1_500);
    expect(quote.totalChargeCents).toBe(51_500);
    expect(quote.outstandingChargeCents).toBe(51_500);
  });

  it('keeps the player total at the league fee when the player share is 0%', () => {
    const quote = buildRegistrationPaymentQuote({
      baseFeeCents: 50_000,
      baseAmountPaidCents: 0,
      platformFeeBps: 300,
      platformFeeMode: 'absorb_by_league',
      playerFeeSharePercent: 0,
    });

    expect(quote.applicationFeeCents).toBe(1_500);
    expect(quote.platformFeeCents).toBe(0);
    expect(quote.totalChargeCents).toBe(50_000);
    expect(quote.outstandingChargeCents).toBe(50_000);
  });

  it('splits the platform fee according to the explicit player share', () => {
    const quote = buildRegistrationPaymentQuote({
      baseFeeCents: 50_000,
      baseAmountPaidCents: 0,
      platformFeeBps: 300,
      platformFeeMode: 'absorb_by_league',
      playerFeeSharePercent: 50,
    });

    expect(quote.applicationFeeCents).toBe(1_500);
    expect(quote.platformFeeCents).toBe(750);
    expect(quote.totalChargeCents).toBe(50_750);
    expect(quote.outstandingChargeCents).toBe(50_750);
  });

  it.each([
    ['pass_to_player', 0, 0],
    ['absorb_by_league', 100, 1_500],
  ] as const)(
    'gives an explicit player share precedence over legacy mode %s at %i%%',
    (platformFeeMode, playerFeeSharePercent, expectedPlayerFeeCents) => {
      const quote = buildRegistrationPaymentQuote({
        baseFeeCents: 50_000,
        platformFeeBps: 300,
        platformFeeMode,
        playerFeeSharePercent,
      });

      expect(quote.platformFeeCents).toBe(expectedPlayerFeeCents);
      expect(quote.applicationFeeCents).toBe(1_500);
    }
  );

  it('rounds the player share after applying the minimum platform fee', () => {
    const quote = buildRegistrationPaymentQuote({
      baseFeeCents: 1_000,
      platformFeeBps: 300,
      platformFeeMode: 'absorb_by_league',
      playerFeeSharePercent: 33,
    });

    expect(quote.applicationFeeCents).toBe(50);
    expect(quote.platformFeeCents).toBe(17);
    expect(quote.totalChargeCents).toBe(1_017);
  });

  it('tracks remaining due and paid display values from the base amount paid', () => {
    const quote = buildRegistrationPaymentQuote({
      baseFeeCents: 50_000,
      baseAmountPaidCents: 25_000,
      platformFeeBps: 300,
      platformFeeMode: 'pass_to_player',
    });

    expect(quote.baseAmountDueCents).toBe(25_000);
    expect(quote.platformFeeCents).toBe(750);
    expect(quote.outstandingChargeCents).toBe(25_750);
    expect(quote.totalPaidDisplayCents).toBe(25_750);
  });

  it('enforces the minimum platform fee when the calculated fee would be too small', () => {
    expect(calculatePlatformFeeCents(1_000, 300)).toBe(50);
  });
});
