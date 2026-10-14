import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';
import { it } from 'node:test';

const modelUrl = new NodeURL('../../src/screens/TeamScreen/teamBroadcastHeroModel.ts', import.meta.url);

it('builds dynamic broadcast facts while preserving every unavailable value honestly', async () => {
  assert.ok(existsSync(fileURLToPath(modelUrl)), 'teamBroadcastHeroModel.ts must isolate TeamPageSnapshot presentation facts');
  const { buildBroadcastTeamHeroModel } = await import(modelUrl.href);
  const base = {
    team: { name: 'Aurora Wolves', primaryColor: '#6046A8', secondaryColor: '#D9B64C' },
    league: { primaryColor: '#1F6A44' },
    standing: { goalsFor: 17, goalsAgainst: 21, goalDifferential: -4 },
    rank: 4,
    record: '3-4-1',
    streak: 'T2',
    hero: { winPercentage: 3 / 8 },
    championships: { count: 2, latestTitleSeasonName: 'Summer 2026', latestTitleLabel: '2026' },
  };
  const known = buildBroadcastTeamHeroModel(base);
  assert.deepEqual(known.tickerColors, ['#6046A8', '#D9B64C']);
  assert.deepEqual(known.callouts, [['RANK', '#4'], ['STREAK', 'T2'], ['WIN PERCENTAGE', '38%']]);
  assert.deepEqual(known.ticker, [['GF', '17'], ['GA', '21'], ['DIFF', '-4'], ['WIN', '38%']]);
  assert.deepEqual(
    [known.record, known.championshipDisplay, known.championshipLabel, known.latestChampionship, known.accent],
    ['3-4-1', 'x2', '2 championships', 'Summer 2026 (2026)', '#6046A8'],
  );

  const unknown = buildBroadcastTeamHeroModel({
    ...base,
    team: { name: 'Solo', primaryColor: 'purple', secondaryColor: 'pink' },
    league: { primaryColor: null },
    standing: null,
    rank: null,
    record: null,
    streak: null,
    hero: { winPercentage: null },
    championships: { count: null, latestTitleSeasonName: null, latestTitleLabel: null },
  });
  assert.deepEqual(unknown.tickerColors, ['#03299B', '#03299B']);
  assert.deepEqual(unknown.callouts, [['RANK', '—'], ['STREAK', '—'], ['WIN PERCENTAGE', '—']]);
  assert.deepEqual(unknown.ticker, [['GF', '—'], ['GA', '—'], ['DIFF', '—'], ['WIN', '—']]);
  assert.deepEqual(
    [unknown.record, unknown.championshipDisplay, unknown.championshipLabel, unknown.latestChampionship, unknown.accent],
    ['—', 'x—', 'Championship count unavailable', null, '#03299B'],
  );
  assert.match(unknown.heroLabel, /record unavailable.*rank unavailable.*championship count unavailable/i);
});
