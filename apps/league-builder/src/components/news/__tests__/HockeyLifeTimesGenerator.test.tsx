import { jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('react', () => {
  const actual = jest.requireActual<typeof import('react')>('react');
  return { ...actual, useState: jest.fn(actual.useState) };
});
jest.mock('@/lib/actions/hockey-life-times', () => ({
  generateHockeyLifeTimesDraft: jest.fn(),
  getHockeyLifeTimesReadiness: jest.fn(),
  publishHockeyLifeTimesEdition: jest.fn(),
  saveHockeyLifeTimesNarrativeDraft: jest.fn(),
}));
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => ({
  playoffTitlePhaseLabel: 'Article title phase',
  playoffTitlePhasePlaceholder: 'Choose a playoff phase',
  playoffTitlePhaseSemis: 'Semis',
  playoffTitlePhaseChampionships: 'Championships',
}[key] || key) }));

import { useState } from 'react';
import { HockeyLifeTimesGenerator } from '../HockeyLifeTimesGenerator';
import type {
  NewspaperEditionRecord,
  NewspaperReadiness,
} from '@/lib/actions/hockey-life-times';

const mockUseState = useState as jest.MockedFunction<typeof useState>;

function renderGenerator(edition: NewspaperEditionRecord, playoffTitlePhaseRequired = false) {
  const readiness: NewspaperReadiness = {
    ready: true,
    errors: [],
    warnings: [],
    games: [],
    existingEdition: edition,
    playoffTitlePhaseRequired,
  };
  const states: unknown[] = [
    'season-1',
    '2026-09-28',
    readiness,
    edition,
    false,
    false,
    null,
    null,
    null,
    '',
  ];
  mockUseState.mockReset();
  for (const value of states) {
    mockUseState.mockImplementationOnce(() => [value, jest.fn()] as never);
  }
  return renderToStaticMarkup(
    <HockeyLifeTimesGenerator
      leagueId="league-1"
      seasons={[{ id: 'season-1', name: 'Fall', status: 'active', startDate: null, endDate: null }]}
    />,
  );
}

function editionRecord(overrides: Partial<NewspaperEditionRecord>): NewspaperEditionRecord {
  return {
    id: 'edition-1',
    league_id: 'league-1',
    season_id: 'season-1',
    period_start: '2026-09-28',
    period_end: '2026-10-04',
    issue_number: 2,
    status: 'draft',
    edition_json: null,
    edition_json_present: false,
    article_id: null,
    generation_error: null,
    generation_method: null,
    lease_expires_at: null,
    generation_lease_active: false,
    version: 0,
    updated_at: '2026-10-03T12:35:28.038336Z',
    ...overrides,
  };
}

describe('Hockey Life Times stored-edition states', () => {
  it('renders an active generating shell without calling it contract corruption', () => {
    const html = renderGenerator(editionRecord({
      status: 'generating',
      generation_lease_active: true,
      lease_expires_at: '2026-10-03T13:00:00Z',
    }));

    expect(html).toMatch(/draft generation is in progress/i);
    expect(html).not.toMatch(/stored draft does not satisfy the newspaper render contract/i);
    expect(html).not.toMatch(/Publish reviewed edition/i);
  });

  it('renders the live failed null-draft shape as generation failure, not contract corruption', () => {
    const html = renderGenerator(editionRecord({
      generation_error: 'Edge Function returned a non-2xx status code',
    }));

    expect(html).toMatch(/draft generation failed/i);
    expect(html).toMatch(/retry/i);
    expect(html).not.toMatch(/stored draft does not satisfy the newspaper render contract/i);
    expect(html).not.toMatch(/Publish reviewed edition/i);
  });

  it('renders an empty null-draft shell separately from a populated corrupt draft', () => {
    const html = renderGenerator(editionRecord({}));

    expect(html).toMatch(/no renderable draft was stored/i);
    expect(html).toMatch(/retry/i);
    expect(html).not.toMatch(/stored draft does not satisfy the newspaper render contract/i);
    expect(html).not.toMatch(/Publish reviewed edition/i);
  });

  it('keeps a populated corrupt draft fail-closed', () => {
    const html = renderGenerator(editionRecord({ edition_json_present: true }));

    expect(html).toMatch(/stored draft does not satisfy the newspaper render contract/i);
    expect(html).not.toMatch(/Publish reviewed edition/i);
  });

  it('retains preview and approval controls for a valid populated draft', () => {
    const fixturePath = path.resolve(__dirname, '../../../../../../packages/hockey-life-times/fixtures/validation-edition.json');
    const edition = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const html = renderGenerator(editionRecord({ edition_json: edition }));

    expect(html).toMatch(/<iframe/i);
    expect(html).toMatch(/Publish reviewed edition/i);
    expect(html).not.toMatch(/stored draft does not satisfy the newspaper render contract/i);
  });

  it('requires an explicit bounded playoff phase for an unresolved legacy bracket', () => {
    const fixturePath = path.resolve(__dirname, '../../../../../../packages/hockey-life-times/fixtures/validation-edition.json');
    const edition = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const html = renderGenerator(editionRecord({ edition_json: edition }), true);

    expect(html).toMatch(/Article title phase/);
    expect(html).toMatch(/<select[^>]*required/);
    expect(html).toMatch(/value="Semis"/);
    expect(html).toMatch(/value="Championships"/);
  });
});
