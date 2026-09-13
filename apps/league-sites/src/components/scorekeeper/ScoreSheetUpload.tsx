'use client';

import { useEffect, useState, useRef } from 'react';
import type { GameData, PlayerData } from '@/lib/actions/scorekeeper';
import { batchAddEvents } from '@/lib/actions/scorekeeper';
import {
  parseOcrAnalysisResult,
  type Confidence,
  type OcrEvent,
  type OcrGoal,
  type OcrPenalty,
} from '@/lib/scorekeeper/ocr';
import { OFFLINE_ACTION_ERROR } from './ui-reliability';

interface ScoreSheetUploadProps {
  gameId: string;
  game: GameData;
  isOnline: boolean;
  onComplete: () => void;
  onClose: () => void;
}

export type ExtractedGoal = OcrGoal;
export type ExtractedPenalty = OcrPenalty;
export type ExtractedEvent = OcrEvent;

type UploadState = 'select' | 'preview' | 'analyzing' | 'review' | 'saving';

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 8;

export function ScoreSheetUpload({ gameId, game, isOnline, onComplete, onClose }: ScoreSheetUploadProps) {
  const [state, setState] = useState<UploadState>('select');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [extractedEvents, setExtractedEvents] = useState<ExtractedEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<{ addedCount: number; errors: string[] } | null>(null);
  const [scoresheetImageUrls, setScoresheetImageUrls] = useState<string[]>([]);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      for (const url of previewUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [previewUrls]);

  function handleFilesSelect(files: FileList | File[] | null, append = false) {
    if (!files || files.length === 0) return;

    const incoming = Array.from(files);
    const validFiles: File[] = [];

    for (const file of incoming) {
      if (file.size > MAX_FILE_SIZE) {
        setError('Each image must be under 10MB');
        return;
      }
      if (!file.type.startsWith('image/')) {
        setError('Please select image files only');
        return;
      }
      validFiles.push(file);
    }

    const nextFiles = append ? [...selectedFiles, ...validFiles] : validFiles;
    const cappedFiles = nextFiles.slice(0, MAX_FILES);
    if (nextFiles.length > MAX_FILES) {
      setError(`Only the first ${MAX_FILES} images were selected`);
    } else {
      setError(null);
    }

    for (const url of previewUrls) {
      URL.revokeObjectURL(url);
    }

    const nextPreviewUrls = cappedFiles.map((file) => URL.createObjectURL(file));
    setSelectedFiles(cappedFiles);
    setPreviewUrls(nextPreviewUrls);
    setState('preview');
  }

  async function handleAnalyze() {
    if (selectedFiles.length === 0) return;
    if (!isOnline) {
      setError(OFFLINE_ACTION_ERROR);
      return;
    }

    setState('analyzing');
    setError(null);

    try {
      const formData = new FormData();
      for (const file of selectedFiles) {
        formData.append('images', file);
      }
      formData.append('gameId', gameId);
      formData.append('homeTeamName', game.homeTeam.name);
      formData.append('awayTeamName', game.awayTeam.name);
      formData.append('homeRoster', JSON.stringify(
        game.homeTeam.roster.map((p: PlayerData) => ({
          jerseyNumber: p.jerseyNumber,
          fullName: p.fullName,
        }))
      ));
      formData.append('awayRoster', JSON.stringify(
        game.awayTeam.roster.map((p: PlayerData) => ({
          jerseyNumber: p.jerseyNumber,
          fullName: p.fullName,
        }))
      ));

      const response = await fetch('/api/scorekeeper/analyze-scoresheet', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Analysis failed');
      }

      const result = await response.json();
      const events = parseOcrAnalysisResult(result);

      const urls = Array.isArray((result as any).scoresheetImageUrls)
        ? (result as any).scoresheetImageUrls.filter((v: unknown): v is string => typeof v === 'string')
        : ((result as any).scoresheetImageUrl ? [(result as any).scoresheetImageUrl as string] : []);
      setScoresheetImageUrls(urls);
      setExtractedEvents(events);
      setState('review');
    } catch (err) {
      console.error('Analysis error:', err);
      setError(err instanceof Error ? err.message : 'Failed to analyze score sheet');
      setState('preview');
    }
  }

  function handleRemoveEvent(id: string) {
    setExtractedEvents((prev) => prev.filter((e) => e.id !== id));
  }

  function handleUpdateEvent(id: string, updatedData: ExtractedGoal | ExtractedPenalty) {
    setExtractedEvents((prev) =>
      prev.map((e) => (e.id === id ? { ...e, data: updatedData } as ExtractedEvent : e))
    );
  }

  async function handleSaveAll() {
    if (extractedEvents.length === 0) return;
    if (!isOnline) {
      setError(OFFLINE_ACTION_ERROR);
      return;
    }

    setState('saving');
    setError(null);

    const mapped = extractedEvents.map((evt) => {
      if (evt.kind === 'goal') {
        const g = evt.data;
        return {
          type: 'goal' as const,
          teamType: g.teamType,
          period: game.scorekeeperTracksTimePeriods ? g.period : null,
          gameTimeSeconds: game.scorekeeperTracksTimePeriods ? g.timeMinutes * 60 + g.timeSeconds : null,
          scorerJersey: g.scorerJersey,
          assist1Jersey: g.assist1Jersey,
          assist2Jersey: g.assist2Jersey,
        };
      } else {
        const p = evt.data;
        return {
          type: 'penalty' as const,
          teamType: p.teamType,
          period: game.scorekeeperTracksTimePeriods ? p.period : null,
          gameTimeSeconds: game.scorekeeperTracksTimePeriods ? p.timeMinutes * 60 + p.timeSeconds : null,
          playerJersey: p.playerJersey,
          penaltyType: p.type,
          penaltyMinutes: p.minutes,
        };
      }
    });

    try {
      const result = await batchAddEvents(gameId, mapped);
      setSaveResult({ addedCount: result.addedCount, errors: result.errors });

      if (result.success) {
        // Brief delay to show result before closing
        setTimeout(() => onComplete(), 1200);
      } else {
        setError('Some events failed to save');
        setState('review');
      }
    } catch (err) {
      console.error('Save error:', err);
      setError('Failed to save events');
      setState('review');
    }
  }

  function findPlayerName(teamType: 'home' | 'away', jersey: number | null): string | null {
    if (jersey == null) return null;
    const roster = teamType === 'home' ? game.homeTeam.roster : game.awayTeam.roster;
    const player = roster.find((p: PlayerData) => p.jerseyNumber === jersey);
    return player?.fullName || null;
  }

  function handleBack() {
    setSelectedFiles([]);
    for (const url of previewUrls) {
      URL.revokeObjectURL(url);
    }
    setPreviewUrls([]);
    setScoresheetImageUrls([]);
    setError(null);
    setState('select');
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--color-background)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Score Sheet Upload
        </h2>
        <button
          onClick={onClose}
          className="p-2 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface)] transition-colors"
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {/* Error banner */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* SELECT state */}
        {state === 'select' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
            <div className="w-full max-w-sm border-2 border-dashed border-[var(--color-border)] rounded-2xl p-8 text-center">
              <svg className="w-12 h-12 mx-auto mb-4 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
              </svg>
              <p className="text-sm text-[var(--color-text-secondary)] mb-6">
                Take a photo of the score sheet or choose from your gallery
              </p>

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-full py-3 px-4 rounded-xl bg-[var(--league-primary,#d4af37)] text-[var(--color-accent-text,#000)] font-semibold transition-all hover:opacity-90 active:scale-95"
                >
                  Take Photo
                </button>
                <button
                  onClick={() => galleryInputRef.current?.click()}
                  className="w-full py-3 px-4 rounded-xl bg-[var(--color-surface)] text-[var(--color-text-primary)] font-medium border border-[var(--color-border)] transition-all hover:bg-[var(--color-surface-hover)] active:scale-95"
                >
                  Choose from Gallery
                </button>
              </div>

            </div>
          </div>
        )}

        {/* PREVIEW state */}
        {state === 'preview' && previewUrls.length > 0 && (
          <div className="flex flex-col items-center gap-4 max-w-sm mx-auto">
            <div className="w-full rounded-xl overflow-hidden border border-[var(--color-border)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrls[0]}
                alt="Score sheet preview"
                className="w-full h-auto"
              />
            </div>
            {previewUrls.length > 1 && (
              <div className="w-full grid grid-cols-4 gap-2">
                {previewUrls.map((url, idx) => (
                  <div key={url} className="rounded-md overflow-hidden border border-[var(--color-border)] aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Score sheet preview ${idx + 1}`} className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-[var(--color-text-secondary)] self-start">
              {selectedFiles.length} image{selectedFiles.length !== 1 ? 's' : ''} selected
            </p>
            <div className="flex gap-3 w-full">
              <button
                onClick={handleBack}
                className="flex-1 py-3 rounded-xl bg-[var(--color-surface)] text-[var(--color-text-primary)] font-medium border border-[var(--color-border)] transition-all hover:bg-[var(--color-surface-hover)] active:scale-95"
              >
                Back
              </button>
              <button
                onClick={() => galleryInputRef.current?.click()}
                className="flex-1 py-3 rounded-xl bg-[var(--color-surface)] text-[var(--color-text-primary)] font-medium border border-[var(--color-border)] transition-all hover:bg-[var(--color-surface-hover)] active:scale-95"
              >
                Add Photos
              </button>
              <button
                onClick={handleAnalyze}
                disabled={!isOnline}
                className="flex-1 py-3 rounded-xl bg-[var(--league-primary,#d4af37)] text-[var(--color-accent-text,#000)] font-semibold transition-all hover:opacity-90 active:scale-95"
              >
                Analyze Score Sheet{selectedFiles.length > 1 ? 's' : ''}
              </button>
            </div>
          </div>
        )}

        {/* ANALYZING state */}
        {state === 'analyzing' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            <div className="w-10 h-10 border-3 border-[var(--color-border)] border-t-[var(--league-primary,#d4af37)] rounded-full animate-spin" />
            <p className="text-sm text-[var(--color-text-secondary)]">
              Analyzing score sheet...
            </p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              This may take a few seconds
            </p>
          </div>
        )}

        {/* REVIEW state */}
        {state === 'review' && (
          <div className="max-w-lg mx-auto">
            {extractedEvents.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm text-[var(--color-text-secondary)]">
                  No events found in the score sheet.
                </p>
                <button
                  onClick={handleBack}
                  className="mt-4 px-4 py-2 rounded-lg text-sm text-[var(--color-text-primary)] bg-[var(--color-surface)] border border-[var(--color-border)]"
                >
                  Try Again
                </button>
              </div>
            ) : (
              <>
                {scoresheetImageUrls.length > 0 && (
                  <div className="mb-3 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-xs text-green-400 flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                    Saved {scoresheetImageUrls.length} scoresheet photo{scoresheetImageUrls.length !== 1 ? 's' : ''} to game record
                  </div>
                )}
                <p className="text-sm text-[var(--color-text-secondary)] mb-4">
                  Found {extractedEvents.length} event{extractedEvents.length !== 1 ? 's' : ''}. Review and remove any incorrect entries before saving.
                </p>

                {/* Group by period */}
                {Array.from(
                  extractedEvents.reduce((map, evt) => {
                    const period = evt.kind === 'goal' ? evt.data.period : evt.data.period;
                    if (!map.has(period)) map.set(period, []);
                    map.get(period)!.push(evt);
                    return map;
                  }, new Map<number, ExtractedEvent[]>())
                )
                  .sort(([a], [b]) => a - b)
                  .map(([period, periodEvents]) => (
                    <div key={period} className="mb-4">
                      <h3 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-2">
                        Period {period}
                      </h3>
                      <div className="space-y-1.5">
                        {periodEvents.map((evt) => (
                          <ReviewEventRow
                            key={evt.id}
                            event={evt}
                            homeTeamName={game.homeTeam.shortName || game.homeTeam.name}
                            awayTeamName={game.awayTeam.shortName || game.awayTeam.name}
                            findPlayerName={findPlayerName}
                            onRemove={() => handleRemoveEvent(evt.id)}
                            onUpdate={(data) => handleUpdateEvent(evt.id, data)}
                            homeRoster={game.homeTeam.roster}
                            awayRoster={game.awayTeam.roster}
                          />
                        ))}
                      </div>
                    </div>
                  ))}

                <div className="flex gap-3 mt-6 sticky bottom-0 py-4 bg-[var(--color-background)]">
                  <button
                    onClick={onClose}
                    className="flex-1 py-3 rounded-xl bg-[var(--color-surface)] text-[var(--color-text-primary)] font-medium border border-[var(--color-border)] transition-all hover:bg-[var(--color-surface-hover)] active:scale-95"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveAll}
                    disabled={!isOnline}
                    className="flex-1 py-3 rounded-xl bg-[var(--league-primary,#d4af37)] text-[var(--color-accent-text,#000)] font-semibold transition-all hover:opacity-90 active:scale-95"
                  >
                    Save All ({extractedEvents.length} events)
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* SAVING state */}
        {state === 'saving' && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
            {saveResult ? (
              <>
                <svg className="w-12 h-12 text-green-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-[var(--color-text-primary)] font-medium">
                  Saved {saveResult.addedCount} event{saveResult.addedCount !== 1 ? 's' : ''}
                </p>
                {saveResult.errors.length > 0 && (
                  <div className="text-xs text-yellow-400 text-center">
                    {saveResult.errors.map((e, i) => (
                      <p key={i}>{e}</p>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="w-10 h-10 border-3 border-[var(--color-border)] border-t-[var(--league-primary,#d4af37)] rounded-full animate-spin" />
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Saving {extractedEvents.length} event{extractedEvents.length !== 1 ? 's' : ''}...
                </p>
              </>
            )}
          </div>
        )}

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            handleFilesSelect(e.target.files, true);
            e.currentTarget.value = '';
          }}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFilesSelect(e.target.files, true);
            e.currentTarget.value = '';
          }}
        />
      </div>
    </div>
  );
}

// =============================================================================
// ReviewEventRow sub-component
// =============================================================================

function ConfidenceBadge({ level }: { level?: Confidence }) {
  if (!level || level === 'high') return null;
  const color = level === 'medium' ? 'text-yellow-400 bg-yellow-500/10' : 'text-red-400 bg-red-500/10';
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${color}`}>
      {level === 'medium' ? 'Uncertain' : 'Low confidence'}
    </span>
  );
}

function ReviewEventRow({
  event,
  homeTeamName,
  awayTeamName,
  findPlayerName,
  onRemove,
  onUpdate,
  homeRoster,
  awayRoster,
}: {
  event: ExtractedEvent;
  homeTeamName: string;
  awayTeamName: string;
  findPlayerName: (teamType: 'home' | 'away', jersey: number | null) => string | null;
  onRemove: () => void;
  onUpdate: (data: ExtractedGoal | ExtractedPenalty) => void;
  homeRoster: PlayerData[];
  awayRoster: PlayerData[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const isGoal = event.kind === 'goal';
  const data = event.data;
  const teamName = data.teamType === 'home' ? homeTeamName : awayTeamName;
  const time = `${data.timeMinutes}:${data.timeSeconds.toString().padStart(2, '0')}`;
  const roster = data.teamType === 'home' ? homeRoster : awayRoster;

  let label: string;
  let hasWarning = false;

  if (isGoal) {
    const g = data as ExtractedGoal;
    const scorerName = findPlayerName(g.teamType, g.scorerJersey);
    if (!scorerName) hasWarning = true;
    label = `GOAL - #${g.scorerJersey} ${scorerName || '(unknown)'}`;
    if (g.assist1Jersey != null) {
      const a1Name = findPlayerName(g.teamType, g.assist1Jersey);
      if (!a1Name) hasWarning = true;
      label += ` (A: #${g.assist1Jersey} ${a1Name || '?'}`;
      if (g.assist2Jersey != null) {
        const a2Name = findPlayerName(g.teamType, g.assist2Jersey);
        if (!a2Name) hasWarning = true;
        label += `, #${g.assist2Jersey} ${a2Name || '?'}`;
      }
      label += ')';
    }
  } else {
    const p = data as ExtractedPenalty;
    const playerName = findPlayerName(p.teamType, p.playerJersey);
    if (!playerName) hasWarning = true;
    label = `PENALTY - #${p.playerJersey} ${playerName || '(unknown)'} - ${p.type} (${p.minutes}min)`;
  }

  // Inline edit mode — show dropdowns to correct jersey numbers
  if (isEditing) {
    return (
      <div className="p-3 rounded-lg bg-[var(--color-surface)] border border-[var(--league-primary,#d4af37)]/30 space-y-2">
        <div className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase">
          Edit {isGoal ? 'Goal' : 'Penalty'} — P{data.period} {time}
        </div>
        {isGoal ? (
          <GoalJerseyEditor
            goal={data as ExtractedGoal}
            roster={roster}
            onSave={(updated) => { onUpdate(updated); setIsEditing(false); }}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <PenaltyJerseyEditor
            penalty={data as ExtractedPenalty}
            roster={roster}
            onSave={(updated) => { onUpdate(updated); setIsEditing(false); }}
            onCancel={() => setIsEditing(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg bg-[var(--color-surface)] group">
      {/* Icon */}
      <div
        className={`flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 ${
          isGoal ? 'bg-green-500/10 text-green-400' : 'bg-yellow-500/10 text-yellow-400'
        }`}
      >
        {isGoal ? (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2L2 22h20L12 2z" />
          </svg>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-[var(--color-text-primary)] truncate">
          {label}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-xs text-[var(--color-text-secondary)]">
            {time}
          </span>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {teamName}
          </span>
          <ConfidenceBadge level={data.confidence} />
          {hasWarning && (
            <span className="text-[10px] font-bold text-orange-400">
              Jersey not found
            </span>
          )}
        </div>
      </div>

      {/* Edit button — shown when there's a warning or low confidence */}
      {(hasWarning || data.confidence === 'low' || data.confidence === 'medium') && (
        <button
          onClick={() => setIsEditing(true)}
          className="flex-shrink-0 p-2 rounded-lg hover:bg-blue-500/10 text-[var(--color-text-secondary)] hover:text-blue-400 transition-all"
          aria-label="Edit event"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
          </svg>
        </button>
      )}

      {/* Remove button */}
      <button
        onClick={onRemove}
        className="flex-shrink-0 p-2 rounded-lg hover:bg-red-500/10 text-[var(--color-text-secondary)] hover:text-red-400 transition-all"
        aria-label="Remove event"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// Inline jersey editor for goals
function GoalJerseyEditor({
  goal,
  roster,
  onSave,
  onCancel,
}: {
  goal: ExtractedGoal;
  roster: PlayerData[];
  onSave: (g: ExtractedGoal) => void;
  onCancel: () => void;
}) {
  const [scorer, setScorer] = useState(goal.scorerJersey);
  const [a1, setA1] = useState(goal.assist1Jersey);
  const [a2, setA2] = useState(goal.assist2Jersey);

  return (
    <div className="space-y-2">
      <JerseySelect
        label="Scorer"
        value={scorer}
        roster={roster}
        onChange={(v) => setScorer(v ?? goal.scorerJersey)}
      />
      <JerseySelect label="Assist 1" value={a1} roster={roster} onChange={setA1} allowNull />
      <JerseySelect label="Assist 2" value={a2} roster={roster} onChange={setA2} allowNull />
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 py-2 text-xs rounded-lg bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">Cancel</button>
        <button onClick={() => onSave({ ...goal, scorerJersey: scorer, assist1Jersey: a1, assist2Jersey: a2, confidence: 'high' })} className="flex-1 py-2 text-xs rounded-lg bg-[var(--league-primary,#d4af37)] text-[var(--color-accent-text,#000)] font-semibold">Save</button>
      </div>
    </div>
  );
}

// Inline jersey editor for penalties
function PenaltyJerseyEditor({
  penalty,
  roster,
  onSave,
  onCancel,
}: {
  penalty: ExtractedPenalty;
  roster: PlayerData[];
  onSave: (p: ExtractedPenalty) => void;
  onCancel: () => void;
}) {
  const [jersey, setJersey] = useState(penalty.playerJersey);

  return (
    <div className="space-y-2">
      <JerseySelect
        label="Player"
        value={jersey}
        roster={roster}
        onChange={(v) => setJersey(v ?? penalty.playerJersey)}
      />
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="flex-1 py-2 text-xs rounded-lg bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-secondary)]">Cancel</button>
        <button onClick={() => onSave({ ...penalty, playerJersey: jersey, confidence: 'high' })} className="flex-1 py-2 text-xs rounded-lg bg-[var(--league-primary,#d4af37)] text-[var(--color-accent-text,#000)] font-semibold">Save</button>
      </div>
    </div>
  );
}

// Reusable jersey dropdown
function JerseySelect({
  label,
  value,
  roster,
  onChange,
  allowNull = false,
}: {
  label: string;
  value: number | null;
  roster: PlayerData[];
  onChange: (v: number | null) => void;
  allowNull?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--color-text-secondary)] w-16">{label}:</span>
      <select
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? null : Number(v));
        }}
        className="flex-1 text-sm rounded-lg px-2 py-1.5 bg-[var(--color-background)] border border-[var(--color-border)] text-[var(--color-text-primary)]"
      >
        {allowNull && <option value="">None</option>}
        {roster.map((p: PlayerData) => (
          <option key={p.jerseyNumber} value={p.jerseyNumber}>
            #{p.jerseyNumber} {p.fullName}
          </option>
        ))}
        {value != null && !roster.some((p: PlayerData) => p.jerseyNumber === value) && (
          <option value={value}>#{value} (not on roster)</option>
        )}
      </select>
    </div>
  );
}
