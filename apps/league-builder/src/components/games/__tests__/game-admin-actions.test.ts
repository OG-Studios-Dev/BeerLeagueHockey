import fs from 'node:fs';
import path from 'node:path';
import { getGameAdminActionAvailability } from '../game-admin-actions';

const leagueBuilderRoot = path.resolve(__dirname, '../../../..');

describe('getGameAdminActionAvailability', () => {
  it.each([
    ['scheduled', true, false],
    ['in_progress', true, false],
    ['pending_verification', true, false],
    ['completed', false, true],
    ['cancelled', false, false],
    ['postponed', false, false],
  ] as const)('returns game admin actions for %s games', (status, canCompleteGame, canGenerateGameRecap) => {
    expect(getGameAdminActionAvailability(status)).toEqual({
      canCompleteGame,
      canGenerateGameRecap,
    });
  });
});

describe('game recap admin control', () => {
  it('renders a visible localized label and keeps both locale strings', () => {
    const component = fs.readFileSync(
      path.resolve(leagueBuilderRoot, 'src/components/games/game-card.tsx'),
      'utf8',
    );
    const en = JSON.parse(
      fs.readFileSync(path.resolve(leagueBuilderRoot, 'src/messages/en.json'), 'utf8'),
    );
    const fr = JSON.parse(
      fs.readFileSync(path.resolve(leagueBuilderRoot, 'src/messages/fr.json'), 'utf8'),
    );

    expect(component).toContain("const t = useTranslations('schedule');");
    expect(component).toContain("<span>{t('generateGameRecap')}</span>");
    expect(en.schedule.generateGameRecap).toBe('Generate Game Recap');
    expect(fr.schedule.generateGameRecap).toBe('Generer le recapitulatif');
  });

  it('does not describe game recaps as automatic', () => {
    const builderUpsell = fs.readFileSync(
      path.resolve(leagueBuilderRoot, 'src/components/league-wizard/steps/step-6-addons.tsx'),
      'utf8',
    );
    const sitesUpsell = fs.readFileSync(
      path.resolve(leagueBuilderRoot, '../league-sites/src/components/shared/AddonUpsell.tsx'),
      'utf8',
    );
    const catalogs = [
      fs.readFileSync(path.resolve(leagueBuilderRoot, 'src/messages/en.json'), 'utf8'),
      fs.readFileSync(path.resolve(leagueBuilderRoot, 'src/messages/fr.json'), 'utf8'),
    ].join('\n');

    expect(`${builderUpsell}\n${sitesUpsell}\n${catalogs}`).not.toMatch(
      /automatic game recaps|auto-generated game recaps|recaps de matchs generes automatiquement/i,
    );
  });
});
