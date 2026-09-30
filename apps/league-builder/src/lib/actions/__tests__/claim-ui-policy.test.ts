import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('pending claim UI policy', () => {
  it('removes automatic-claim language and localizes the pending approval state', () => {
    const historySource = readFileSync(
      resolve(__dirname, '../../../app/[locale]/claim-history/ClaimHistoryClient.tsx'),
      'utf8'
    );
    const signupSource = readFileSync(
      resolve(__dirname, '../../../app/[locale]/(auth)/signup/page.tsx'),
      'utf8'
    );
    const en = JSON.parse(readFileSync(resolve(__dirname, '../../../messages/en.json'), 'utf8'));
    const fr = JSON.parse(readFileSync(resolve(__dirname, '../../../messages/fr.json'), 'utf8'));

    expect(historySource).not.toContain('This is me');
    expect(historySource).not.toContain('Claiming...');
    expect(signupSource).not.toContain('Claim your stats and team history');
    expect(en.claimHistory.pendingApproval).toBe('Pending admin approval');
    expect(fr.claimHistory.pendingApproval).toContain('administrateur');
    expect(en.auth.playerHistoryReviewDescription).toContain('no history moves until approval');
    expect(fr.auth.playerHistoryReviewDescription).toContain("avant l'approbation");
  });
});
