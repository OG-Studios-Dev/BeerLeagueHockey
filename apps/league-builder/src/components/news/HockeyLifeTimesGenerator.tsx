'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, FileCheck2, Loader2, Newspaper, Pencil, RefreshCw, Save } from 'lucide-react';
import {
  generateHockeyLifeTimesDraft,
  getHockeyLifeTimesReadiness,
  publishHockeyLifeTimesEdition,
  saveHockeyLifeTimesNarrativeDraft,
  type NewspaperEditionRecord,
  type NewspaperReadiness,
  type NewspaperSeasonOption,
  type HockeyLifeTimesPlayoffTitlePhase,
} from '@/lib/actions/hockey-life-times';
import {
  editorStateFromEdition,
  narrativePatchFromEditorState,
  updateLeadBodyDraft,
  type HockeyLifeTimesEditorState,
} from './hockey-life-times-editor';
import {
  renderNewspaperHtml,
  validateNewspaperEdition,
  type NewspaperEdition,
} from '../../../../../packages/hockey-life-times/src/index';
import { illustrationFailureMessage } from '@/lib/hockey-life-times/illustration-errors';

function localDateInToronto() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function mondayOfWeek(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  const weekday = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - ((weekday + 6) % 7));
  return date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function rejectedActionMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : 'The newspaper action failed unexpectedly. Please try again.';
}

export function HockeyLifeTimesGenerator({
  leagueId,
  seasons,
}: {
  leagueId: string;
  seasons: NewspaperSeasonOption[];
}) {
  const t = useTranslations('news');
  const activeSeason = seasons.find((season) => season.status === 'active' || season.status === 'playoffs') || seasons[0];
  const initialStart = mondayOfWeek(localDateInToronto());
  const [seasonId, setSeasonId] = useState(activeSeason?.id || '');
  const [periodStart, setPeriodStart] = useState(initialStart);
  const [readiness, setReadiness] = useState<NewspaperReadiness | null>(null);
  const [edition, setEdition] = useState<NewspaperEditionRecord | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [narrative, setNarrative] = useState<HockeyLifeTimesEditorState | null>(null);
  const [busy, setBusy] = useState<'check' | 'generate' | 'save' | 'publish' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [playoffTitlePhase, setPlayoffTitlePhase] = useState<HockeyLifeTimesPlayoffTitlePhase | ''>('');

  const periodEnd = useMemo(() => addDays(periodStart, 6), [periodStart]);
  const activeGeneration = edition?.status === 'generating'
    && edition.generation_lease_active;
  const previewHtml = useMemo(() => {
    if (!edition?.edition_json) return null;
    try {
      validateNewspaperEdition(edition.edition_json);
      return renderNewspaperHtml(edition.edition_json as NewspaperEdition);
    } catch {
      return null;
    }
  }, [edition]);

  async function checkReadiness() {
    if (!seasonId || !periodStart) return;
    setBusy('check');
    setMessage(null);
    setReviewed(false);
    try {
      const result = await getHockeyLifeTimesReadiness({ leagueId, seasonId, periodStart, periodEnd });
      if (result.success) {
        setPlayoffTitlePhase('');
        setReadiness(result.data);
        setEdition(result.data.existingEdition);
        setNarrative(result.data.existingEdition?.edition_json
          ? editorStateFromEdition(result.data.existingEdition.edition_json as NewspaperEdition)
          : null);
      } else {
        setMessage(result.error);
        setReadiness(null);
      }
    } catch (error) {
      setMessage(rejectedActionMessage(error));
      setReadiness(null);
    } finally {
      setBusy(null);
    }
  }

  async function generateDraft() {
    setBusy('generate');
    setMessage(null);
    setReviewed(false);
    try {
      const result = await generateHockeyLifeTimesDraft({ leagueId, seasonId, periodStart, periodEnd });
      if (result.success) {
        setEdition(result.data);
        setNarrative(result.data.edition_json ? editorStateFromEdition(result.data.edition_json as NewspaperEdition) : null);
        setReadiness((current) => current ? { ...current, existingEdition: result.data } : current);
        setMessage('Draft generated from verified facts. It is not public. Review every page before publishing.');
      } else {
        setMessage(result.error);
      }
    } catch (error) {
      setMessage(rejectedActionMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function publishEdition() {
    if (!edition || !reviewed) return;
    setBusy('publish');
    setMessage(null);
    try {
      const result = await publishHockeyLifeTimesEdition({
        leagueId,
        editionId: edition.id,
        expectedVersion: edition.version,
        playoffTitlePhase: playoffTitlePhase || undefined,
      });
      if (result.success) {
        await checkReadiness();
        setMessage('Edition published. The linked public article now uses this exact reviewed snapshot.');
      } else {
        setMessage(result.error);
      }
    } catch (error) {
      setMessage(rejectedActionMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function saveNarrative() {
    if (!edition || !narrative) return;
    setBusy('save');
    setMessage(null);
    setReviewed(false);
    try {
      const result = await saveHockeyLifeTimesNarrativeDraft({
        leagueId,
        editionId: edition.id,
        expectedVersion: edition.version,
        narrative: narrativePatchFromEditorState(narrative),
      });
      if (result.success) {
        setEdition(result.data);
        setNarrative(result.data.edition_json ? editorStateFromEdition(result.data.edition_json as NewspaperEdition) : null);
        setReadiness((current) => current ? { ...current, existingEdition: result.data } : current);
        setEditing(false);
        setMessage('Narrative edits saved. Scores, stat rows, source IDs, and the fact-pack digest were preserved.');
      } else {
        setMessage(result.error);
      }
    } catch (error) {
      setMessage(rejectedActionMessage(error));
    } finally {
      setBusy(null);
    }
  }

  if (!seasons.length) return null;

  return (
    <section className="mb-8 overflow-hidden rounded-2xl border border-amber-300/25 bg-amber-100/[0.06]">
      <div className="border-b border-amber-300/20 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-amber-300">
              <Newspaper className="h-5 w-5" />
              <span className="text-xs font-black uppercase tracking-[0.18em]">Manual newspaper workflow</span>
            </div>
            <h2 className="text-2xl font-black text-white">Generate Hockey Life Times</h2>
            <p className="mt-1 max-w-2xl text-sm text-neutral-400">
              Select a Toronto-local week, confirm every listed game is final, generate a private draft, then publish only after reviewing the full five-page edition.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(190px,1fr)_170px_auto]">
            <label className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Season
              <select
                value={seasonId}
                disabled={Boolean(busy)}
                onChange={(event) => { setSeasonId(event.target.value); setReadiness(null); setEdition(null); setNarrative(null); }}
                className="mt-1 block w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2.5 text-sm normal-case tracking-normal text-white"
              >
                {seasons.map((season) => <option key={season.id} value={season.id}>{season.name} ({season.status})</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
              Week starts
              <input
                type="date"
                value={periodStart}
                min="2020-01-06"
                step={7}
                disabled={Boolean(busy)}
                onChange={(event) => { setPeriodStart(mondayOfWeek(event.target.value)); setReadiness(null); setEdition(null); setNarrative(null); }}
                className="mt-1 block w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm normal-case tracking-normal text-white"
              />
            </label>
            <button
              type="button"
              onClick={checkReadiness}
              disabled={Boolean(busy) || !seasonId || !periodStart}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-300/30 bg-amber-300/10 px-4 py-2.5 text-sm font-bold text-amber-200 hover:bg-amber-300/15 disabled:opacity-50"
            >
              {busy === 'check' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
              Check readiness
            </button>
          </div>
        </div>
      </div>

      {message && <div className="border-b border-white/10 px-5 py-3 text-sm text-amber-100">{message}</div>}

      {readiness && (
        <div className="space-y-5 p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
            <div>
              <div className={`mb-3 text-sm font-bold ${readiness.ready ? 'text-emerald-400' : 'text-red-300'}`}>
                {readiness.ready ? 'Ready to generate a draft' : 'Not ready to generate'} · {periodStart} to {periodEnd}
              </div>
              <div className="divide-y divide-white/10 rounded-xl border border-white/10">
                {readiness.games.length ? readiness.games.map((game) => (
                  <div key={game.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <span className="font-semibold text-white">{game.matchup}</span>
                    <span className="text-neutral-400">{game.status}{game.score ? ` · ${game.score}` : ''}</span>
                  </div>
                )) : <div className="px-4 py-3 text-sm text-neutral-400">No games found in this week.</div>}
              </div>
              {readiness.errors.map((error) => <p key={error} className="mt-2 text-sm text-red-300">{error}</p>)}
              {readiness.warnings.map((warning) => <p key={warning} className="mt-2 text-sm text-amber-300">{warning}</p>)}
            </div>
            <button
              type="button"
              onClick={generateDraft}
              disabled={Boolean(busy) || !readiness.ready || activeGeneration}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-300 px-5 py-3 text-sm font-black text-black hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === 'generate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {edition?.status === 'draft'
                ? edition.edition_json ? 'Regenerate draft' : 'Retry generation'
                : activeGeneration ? 'Generation in progress' : edition?.status === 'generating' ? 'Retry expired generation' : 'Generate draft'}
            </button>
          </div>

          {edition && (
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Eye className="h-4 w-4 text-amber-300" />
                    <h3 className="font-bold text-white">
                      Issue {edition.issue_number} {edition.edition_json ? 'full preview' : edition.status === 'generating' ? 'generation in progress' : 'generation attempt'}
                    </h3>
                  </div>
                  <p className="mt-1 text-xs text-neutral-400">
                    Status: {edition.status} · version {edition.version} · {edition.generation_method || 'generation method unavailable'}
                  </p>
                </div>
                {edition.status === 'draft' && previewHtml && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => { setEditing((value) => !value); setReviewed(false); }}
                      disabled={Boolean(busy)}
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-300/30 px-3 py-2 text-sm font-bold text-amber-200 disabled:opacity-40"
                    >
                      <Pencil className="h-4 w-4" /> {editing ? 'Close editor' : 'Edit narrative'}
                    </button>
                    {readiness?.playoffTitlePhaseRequired && (
                      <label className="text-sm text-neutral-300">
                        {t('playoffTitlePhaseLabel')}
                        <select
                          value={playoffTitlePhase}
                          required
                          disabled={Boolean(busy)}
                          onChange={(event) => setPlayoffTitlePhase(event.target.value as HockeyLifeTimesPlayoffTitlePhase | '')}
                          className="ml-2 rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-white"
                        >
                          <option value="">{t('playoffTitlePhasePlaceholder')}</option>
                          <option value="Semis">{t('playoffTitlePhaseSemis')}</option>
                          <option value="Championships">{t('playoffTitlePhaseChampionships')}</option>
                        </select>
                      </label>
                    )}
                    <label className="flex items-center gap-2 text-sm text-neutral-300">
                      <input type="checkbox" checked={reviewed} disabled={editing || Boolean(busy)} onChange={(event) => setReviewed(event.target.checked)} />
                      I reviewed all five pages
                    </label>
                    <button
                      type="button"
                      onClick={publishEdition}
                      disabled={Boolean(busy) || !reviewed || editing || Boolean(readiness?.playoffTitlePhaseRequired && !playoffTitlePhase)}
                      className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-black text-black hover:bg-emerald-400 disabled:opacity-40"
                    >
                      {busy === 'publish' ? 'Publishing…' : 'Publish reviewed edition'}
                    </button>
                  </div>
                )}
              </div>
              {editing && narrative && edition.status === 'draft' && (
                <div className="mb-4 space-y-4 rounded-xl border border-amber-300/20 bg-neutral-950/70 p-4">
                  <p className="text-xs text-neutral-400">Narrative fields only. Scores, contributors, stars, number rows, standings, source IDs, warnings, artwork, and digest cannot be changed here.</p>
                  <label className="block text-xs font-bold uppercase tracking-wide text-neutral-400">
                    Lead headline
                    <input value={narrative.lead.headline} disabled={Boolean(busy)} onChange={(event) => setNarrative({ ...narrative, lead: { ...narrative.lead, headline: event.target.value } })} className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm normal-case text-white" />
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-wide text-neutral-400">
                    Lead dek
                    <textarea value={narrative.lead.dek} disabled={Boolean(busy)} onChange={(event) => setNarrative({ ...narrative, lead: { ...narrative.lead, dek: event.target.value } })} rows={2} className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm normal-case text-white" />
                  </label>
                  <label className="block text-xs font-bold uppercase tracking-wide text-neutral-400">
                    Lead body (blank line between paragraphs)
                    <textarea value={narrative.lead.body} disabled={Boolean(busy)} onChange={(event) => setNarrative(updateLeadBodyDraft(narrative, event.target.value))} rows={6} className="mt-1 w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm normal-case text-white" />
                  </label>
                  {narrative.games.map((game, index) => (
                    <div key={game.gameId} className="space-y-3 border-t border-white/10 pt-4">
                      <p className="text-xs font-black uppercase tracking-wide text-amber-300">Game {index + 1} narrative</p>
                      <input value={game.headline} disabled={Boolean(busy)} aria-label={`Game ${index + 1} headline`} onChange={(event) => setNarrative({ ...narrative, games: narrative.games.map((item) => item.gameId === game.gameId ? { ...item, headline: event.target.value } : item) })} className="w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white" />
                      <textarea value={game.body} disabled={Boolean(busy)} aria-label={`Game ${index + 1} body`} onChange={(event) => setNarrative({ ...narrative, games: narrative.games.map((item) => item.gameId === game.gameId ? { ...item, body: event.target.value } : item) })} rows={6} className="w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white" />
                    </div>
                  ))}
                  <button type="button" onClick={saveNarrative} disabled={Boolean(busy)} className="inline-flex items-center gap-2 rounded-lg bg-amber-300 px-4 py-2 text-sm font-black text-black disabled:opacity-40">
                    {busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save narrative edits
                  </button>
                </div>
              )}
              {previewHtml ? (
                <div className="overflow-hidden rounded-lg border border-white/10 bg-neutral-800">
                  <iframe
                    title={`Hockey Life Times issue ${edition.issue_number} draft preview`}
                    srcDoc={previewHtml}
                    sandbox=""
                    className="h-[900px] w-full"
                  />
                </div>
              ) : edition.status === 'generating' ? (
                <p className="text-sm text-amber-200">Draft generation is in progress. No publishable draft exists yet.</p>
              ) : edition.edition_json_present ? (
                <p className="text-sm text-red-300">This stored draft does not satisfy the newspaper render contract and cannot be published.</p>
              ) : !edition.edition_json && edition.generation_error ? (
                <div className="space-y-1 text-sm text-red-300">
                  <p>Draft generation failed before a renderable draft was stored.</p>
                  <p>{illustrationFailureMessage(edition.generation_error)}</p>
                </div>
              ) : !edition.edition_json ? (
                <p className="text-sm text-red-300">No renderable draft was stored. Retry generation; no edition was published.</p>
              ) : null}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
