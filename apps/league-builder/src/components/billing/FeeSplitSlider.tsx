'use client';

import { useState, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { updateLeagueFeeShare } from '@/lib/actions/fees';

interface FeeSplitSliderProps {
  leagueId: string;
  platformFeeBps: number;
  initialSharePercent: number;
  pricingTier: string;
}

function formatDollars(cents: number): string {
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency: 'CAD',
  }).format(cents / 100);
}

export function FeeSplitSlider({
  leagueId,
  platformFeeBps,
  initialSharePercent,
  pricingTier,
}: FeeSplitSliderProps) {
  const t = useTranslations('billing.feeSplit');
  const [sharePercent, setSharePercent] = useState(initialSharePercent);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSave = useCallback(
    (value: number) => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(async () => {
        setSaving(true);
        const result = await updateLeagueFeeShare(leagueId, value);
        setSaving(false);
        if (result.success) {
          toast.success(t('saved'));
        } else {
          toast.error(t('saveFailed'), { description: result.error });
        }
      }, 500);
    },
    [leagueId, t]
  );

  // Don't render for small tier (flat fee, no percentage)
  if (pricingTier === 'small') return null;

  const feePercent = (platformFeeBps / 100).toFixed(2);

  // Preview calculation for a $100 registration (10000 cents)
  const baseAmountCents = 10000;
  const totalFeeCents = Math.round((baseAmountCents * platformFeeBps) / 10000);
  const playerShareCents = Math.round(totalFeeCents * sharePercent / 100);
  const playerPaysCents = baseAmountCents + playerShareCents;
  const leagueReceivesCents = baseAmountCents - (totalFeeCents - playerShareCents);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = Number(e.target.value);
    setSharePercent(value);
    debouncedSave(value);
  }

  return (
    <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-white">{t('title')}</h3>
        <p className="text-xs text-neutral-500">{t('description', { percent: feePercent })}</p>
      </div>

      {/* Slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-xs text-neutral-500">{t('leagueAbsorbs')}</span>
          <span className="text-xs text-neutral-500">{t('playersPay')}</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={sharePercent}
          onChange={handleChange}
          className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-primary bg-white/10"
        />
        <div className="flex items-center justify-center gap-1.5">
          <span className="text-sm font-semibold text-white tabular-nums">{sharePercent}%</span>
          {saving && (
            <span className="text-xs text-neutral-500 animate-pulse">Saving...</span>
          )}
        </div>
      </div>

      {/* Compact Preview */}
      <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2.5">
        <p className="text-xs font-medium text-neutral-400 mb-1.5">{t('previewTitle')}</p>
        <div className="grid grid-cols-3 gap-x-3 text-xs">
          <div>
            <p className="text-neutral-500">{t('playerCharge')}</p>
            <p className="font-semibold text-white tabular-nums">{formatDollars(playerPaysCents)}</p>
          </div>
          <div>
            <p className="text-neutral-500">{t('leagueReceives')}</p>
            <p className="font-semibold text-white tabular-nums">{formatDollars(leagueReceivesCents)}</p>
          </div>
          <div>
            <p className="text-neutral-500">{t('platformGets')}</p>
            <p className="font-semibold text-white tabular-nums">{formatDollars(totalFeeCents)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
