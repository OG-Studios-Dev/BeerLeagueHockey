'use client';

import type { ChangeEvent } from 'react';
import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { cn } from '@hockey-life/ui';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { createClient as createBrowserSupabaseClient } from '@/lib/supabase/client';
import {
  prepareMigrationAssetUpload,
  finalizeMigrationAssetUpload,
  deleteMigrationAsset,
  upsertLeagueMigrationRequest,
} from '@/lib/actions/migration-requests';
import { importMigrationAssetFromUrl } from '@/lib/actions/migration-url-import';
import {
  MIGRATION_SCOPE_META,
  MIGRATION_SCOPE_OPTIONS,
  MIGRATION_STATUS_META,
  isMigrationStatusActive,
  isMigrationStatusEditable,
  type LeagueMigrationRequest,
  type LeagueMigrationScope,
  type MigrationUploadedAsset,
} from '@/lib/migration/requests';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Database,
  FileStack,
  Globe,
  Link2,
  Loader2,
  ScanSearch,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';

type Props = {
  leagueId: string;
  locale: string;
  requests: LeagueMigrationRequest[];
};

type WizardStep = 'scope' | 'files' | 'review';

const STEP_ORDER: WizardStep[] = ['scope', 'files', 'review'];

const SCOPE_ICONS: Record<LeagueMigrationScope, string> = {
  teams: '🏒',
  players: '👥',
  schedule: '📅',
  stats_records: '📊',
  news_archive: '📰',
  media_archive: '📸',
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function MigrationWizard({ leagueId, locale, requests }: Props) {
  const activeRequest = useMemo(
    () => requests.find((r) => isMigrationStatusActive(r.status)) ?? null,
    [requests]
  );
  const editableRequest =
    activeRequest && isMigrationStatusEditable(activeRequest.status) ? activeRequest : null;

  // If there's an active non-editable request, show status view
  if (activeRequest && !editableRequest) {
    return <ActiveRequestStatus request={activeRequest} />;
  }

  return (
    <WizardForm
      leagueId={leagueId}
      locale={locale}
      editableRequest={editableRequest}
    />
  );
}

function ActiveRequestStatus({ request }: { request: LeagueMigrationRequest }) {
  return (
    <div className="rounded-[28px] border border-cyan-400/15 bg-white/[0.04] p-6 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10">
          <Database className="h-5 w-5 text-cyan-300" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Migration in progress</h2>
          <p className="text-sm text-neutral-400">
            {MIGRATION_STATUS_META[request.status].description}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {request.scope.map((scope) => (
          <span
            key={scope}
            className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-neutral-100"
          >
            {SCOPE_ICONS[scope]} {MIGRATION_SCOPE_META[scope].label}
          </span>
        ))}
      </div>

      {request.admin_notes && (
        <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
            Update from our team
          </p>
          <p className="mt-2 text-sm leading-6 text-neutral-300">{request.admin_notes}</p>
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Status" value={MIGRATION_STATUS_META[request.status].label} />
        <StatCard label="Files uploaded" value={String(request.uploaded_assets.length)} />
        <StatCard label="Tracks" value={String(request.scope.length)} />
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">{label}</p>
      <p className="mt-2 text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function WizardForm({
  leagueId,
  locale,
  editableRequest,
}: {
  leagueId: string;
  locale: string;
  editableRequest: LeagueMigrationRequest | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<WizardStep>('scope');
  const [scope, setScope] = useState<LeagueMigrationScope[]>(editableRequest?.scope ?? []);
  const [sourceSystem, setSourceSystem] = useState(editableRequest?.source_system ?? '');
  const [sourceUrl, setSourceUrl] = useState(editableRequest?.source_url ?? '');
  const [notes, setNotes] = useState(editableRequest?.notes ?? '');
  const [uploadedAssets, setUploadedAssets] = useState<MigrationUploadedAsset[]>(
    editableRequest?.uploaded_assets ?? []
  );
  const [isUploading, setIsUploading] = useState(false);
  const [urlImportValue, setUrlImportValue] = useState('');
  const [isImportingUrl, setIsImportingUrl] = useState(false);
  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | undefined>(editableRequest?.id);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const currentStepIndex = STEP_ORDER.indexOf(step);

  function toggleScope(s: LeagueMigrationScope) {
    setScope((prev) =>
      prev.includes(s) ? prev.filter((v) => v !== s) : [...prev, s]
    );
  }

  function canProceed(): boolean {
    if (step === 'scope') return scope.length > 0;
    return true;
  }

  function goNext() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) {
      // Auto-save draft when leaving scope step
      if (step === 'scope') saveDraft();
      setStep(STEP_ORDER[idx + 1]);
    }
  }

  function goBack() {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) setStep(STEP_ORDER[idx - 1]);
  }

  function saveDraft() {
    startTransition(async () => {
      const result = await upsertLeagueMigrationRequest({
        leagueId,
        locale,
        requestId: draftId,
        mode: 'draft',
        scope,
        sourceSystem: sourceSystem || undefined,
        sourceUrl: sourceUrl || undefined,
        notes: notes || undefined,
      });
      if (result.success) {
        setDraftId(result.data.id);
        setUploadedAssets(result.data.uploaded_assets);
      }
    });
  }

  function submit() {
    startTransition(async () => {
      const result = await upsertLeagueMigrationRequest({
        leagueId,
        locale,
        requestId: draftId,
        mode: 'submit',
        scope,
        sourceSystem: sourceSystem || undefined,
        sourceUrl: sourceUrl || undefined,
        notes: notes || undefined,
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success('Migration request submitted! We\'ll review it and get back to you.');
      router.refresh();
    });
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    setIsUploading(true);
    const browserSupabase = createBrowserSupabaseClient() as any;

    try {
      for (const file of files) {
        const prepareResult = await prepareMigrationAssetUpload({
          leagueId,
          locale,
          requestId: draftId,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || null,
        });

        if (!prepareResult.success) {
          toast.error(prepareResult.error);
          continue;
        }

        if (!draftId) setDraftId(prepareResult.data.requestId);

        const uploadResult = await browserSupabase.storage
          .from('league-migration-assets')
          .uploadToSignedUrl(prepareResult.data.path, prepareResult.data.token, file);

        if (uploadResult.error) {
          toast.error(`Failed to upload ${file.name}`);
          continue;
        }

        const finalizeResult = await finalizeMigrationAssetUpload({
          leagueId,
          locale,
          requestId: prepareResult.data.requestId,
          path: prepareResult.data.path,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type || null,
        });

        if (!finalizeResult.success) {
          toast.error(finalizeResult.error);
          continue;
        }

        setUploadedAssets(finalizeResult.data.uploaded_assets);
        toast.success(`${file.name} uploaded`);
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleUrlImport() {
    if (!urlImportValue.trim() || !draftId) return;
    setIsImportingUrl(true);
    try {
      const result = await importMigrationAssetFromUrl({
        leagueId,
        locale,
        requestId: draftId,
        url: urlImportValue.trim(),
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setUploadedAssets(result.data.uploaded_assets);
      setUrlImportValue('');
      toast.success('File imported from URL');
    } finally {
      setIsImportingUrl(false);
    }
  }

  async function handleDeleteAsset(asset: MigrationUploadedAsset) {
    if (!draftId) return;
    setDeletingAssetId(asset.id);
    try {
      const result = await deleteMigrationAsset({
        leagueId,
        locale,
        requestId: draftId,
        assetId: asset.id,
      });

      if (!result.success) {
        toast.error(result.error);
        return;
      }

      setUploadedAssets(result.data.uploaded_assets);
      toast.success(`${asset.name} removed`);
    } finally {
      setDeletingAssetId(null);
    }
  }

  return (
    <div className="rounded-[28px] border border-cyan-400/15 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.08),_transparent_40%),linear-gradient(160deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] p-6 backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100">
            <Sparkles className="h-3.5 w-3.5" />
            Migration center
          </div>
          <h2 className="mt-4 text-2xl font-black tracking-tight text-white">
            Move your league history into BLH
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-400">
            Three steps. Upload whatever you have — we handle the rest.
          </p>
        </div>
      </div>

      {/* Step indicators */}
      <div className="mt-6 flex items-center gap-2">
        {STEP_ORDER.map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && (
              <div
                className={cn(
                  'h-px w-8',
                  i <= currentStepIndex ? 'bg-cyan-400/40' : 'bg-white/10'
                )}
              />
            )}
            <button
              type="button"
              onClick={() => {
                if (i < currentStepIndex) setStep(s);
              }}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors',
                i === currentStepIndex
                  ? 'border border-cyan-400/30 bg-cyan-400/15 text-cyan-100'
                  : i < currentStepIndex
                    ? 'border border-emerald-400/30 bg-emerald-400/15 text-emerald-100'
                    : 'border border-white/10 bg-white/[0.04] text-neutral-500'
              )}
            >
              {i < currentStepIndex ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </button>
            <span
              className={cn(
                'text-xs font-semibold',
                i === currentStepIndex ? 'text-white' : 'text-neutral-500'
              )}
            >
              {s === 'scope' ? 'What to move' : s === 'files' ? 'Your files' : 'Send it'}
            </span>
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="mt-6">
        {step === 'scope' && (
          <div className="space-y-5">
            <p className="text-sm font-semibold text-white">
              What parts of your old league do you want moved?
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {MIGRATION_SCOPE_OPTIONS.map((s) => {
                const selected = scope.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleScope(s)}
                    className={cn(
                      'flex items-start gap-3 rounded-2xl border p-4 text-left transition-all',
                      selected
                        ? 'border-cyan-400/30 bg-cyan-400/10 ring-1 ring-cyan-400/20'
                        : 'border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]'
                    )}
                  >
                    <span className="mt-0.5 text-lg">{SCOPE_ICONS[s]}</span>
                    <div>
                      <p className={cn('text-sm font-bold', selected ? 'text-cyan-100' : 'text-white')}>
                        {MIGRATION_SCOPE_META[s].label}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-neutral-400">
                        {MIGRATION_SCOPE_META[s].description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-sm font-semibold text-white">Where is it coming from?</span>
                <p className="mt-1 text-xs text-neutral-500">e.g. RAMP, TeamPages, a custom WordPress site, spreadsheets…</p>
                <Input
                  value={sourceSystem}
                  onChange={(e) => setSourceSystem(e.target.value)}
                  placeholder="RAMP Interactive"
                  className="mt-2 border-white/10 bg-black/20 text-white placeholder:text-neutral-500"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-white">Old website URL</span>
                <p className="mt-1 text-xs text-neutral-500">If there&apos;s a public site we can reference, paste the link.</p>
                <Input
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://oldleague.rframp.com"
                  className="mt-2 border-white/10 bg-black/20 text-white placeholder:text-neutral-500"
                />
              </label>
            </div>
          </div>
        )}

        {step === 'files' && (
          <div className="space-y-5">
            <p className="text-sm text-neutral-300">
              Upload exports, spreadsheets, SQL dumps, or anything you have.
              You can also paste a URL to a publicly accessible file and we&apos;ll fetch it.
            </p>

            {/* Upload zone */}
            <div
              className={cn(
                'relative rounded-2xl border-2 border-dashed p-6 text-center transition-colors',
                isUploading
                  ? 'border-cyan-400/30 bg-cyan-400/5'
                  : 'border-white/15 bg-white/[0.02] hover:border-white/25'
              )}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".sql,.csv,.tsv,.json,.xlsx,.xls,.zip,.pdf,.txt,.md,.xml"
                onChange={handleFileUpload}
                className="absolute inset-0 cursor-pointer opacity-0"
                disabled={isUploading}
              />
              <Upload className={cn('mx-auto h-8 w-8', isUploading ? 'text-cyan-300 animate-pulse' : 'text-neutral-500')} />
              <p className="mt-3 text-sm font-semibold text-white">
                {isUploading ? 'Uploading…' : 'Drop files here or click to browse'}
              </p>
              <p className="mt-1 text-xs text-neutral-500">
                SQL, CSV, JSON, Excel, ZIP, PDF, XML, TXT — up to 50MB each
              </p>
            </div>

            {/* URL import */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Globe className="h-4 w-4 text-cyan-300" />
                Import from URL
              </div>
              <p className="mt-1 text-xs text-neutral-500">
                Paste a direct link to a file (Google Drive share link, Dropbox, etc.)
              </p>
              <div className="mt-3 flex gap-2">
                <Input
                  value={urlImportValue}
                  onChange={(e) => setUrlImportValue(e.target.value)}
                  placeholder="https://drive.google.com/..."
                  className="flex-1 border-white/10 bg-black/20 text-white placeholder:text-neutral-500"
                  disabled={isImportingUrl || !draftId}
                />
                <button
                  type="button"
                  onClick={handleUrlImport}
                  disabled={isImportingUrl || !urlImportValue.trim() || !draftId}
                  className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/15 disabled:opacity-50"
                >
                  {isImportingUrl ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
                  Fetch
                </button>
              </div>
              {!draftId && (
                <p className="mt-2 text-xs text-amber-200/80">
                  Go back and select at least one track first — the draft needs to be saved before URL import.
                </p>
              )}
            </div>

            {/* Uploaded files list */}
            {uploadedAssets.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-white">
                  Uploaded files ({uploadedAssets.length})
                </p>
                {uploadedAssets.map((asset) => (
                  <div
                    key={asset.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/20 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">{asset.name}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-neutral-500">{formatBytes(asset.size_bytes)}</span>
                        <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100">
                          {asset.analysis.source_format.replace(/_/g, ' ')}
                        </span>
                        {asset.analysis.detected_scopes.map((s) => (
                          <span key={s} className="text-[10px] text-neutral-400">
                            {SCOPE_ICONS[s]} {MIGRATION_SCOPE_META[s].label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteAsset(asset)}
                      disabled={deletingAssetId === asset.id}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-rose-400/20 bg-rose-400/10 text-rose-200 transition-colors hover:bg-rose-400/20"
                    >
                      {deletingAssetId === asset.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === 'review' && (
          <div className="space-y-5">
            <p className="text-sm text-neutral-300">
              Review everything below and hit send. We&apos;ll reach out once we&apos;ve looked at your data.
            </p>

            {/* Summary */}
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
                Migration tracks
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {scope.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100"
                  >
                    {SCOPE_ICONS[s]} {MIGRATION_SCOPE_META[s].label}
                  </span>
                ))}
              </div>
            </div>

            {(sourceSystem || sourceUrl) && (
              <div className="grid gap-3 sm:grid-cols-2">
                {sourceSystem && (
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">Source</p>
                    <p className="mt-2 text-sm font-semibold text-white">{sourceSystem}</p>
                  </div>
                )}
                {sourceUrl && (
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">Old site</p>
                    <a href={sourceUrl} target="_blank" rel="noreferrer" className="mt-2 block truncate text-sm font-semibold text-cyan-200 hover:text-cyan-100">
                      {sourceUrl}
                    </a>
                  </div>
                )}
              </div>
            )}

            {uploadedAssets.length > 0 && (
              <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-500">
                  Files attached
                </p>
                <div className="mt-3 space-y-2">
                  {uploadedAssets.map((asset) => (
                    <div key={asset.id} className="flex items-center gap-2 text-sm text-neutral-300">
                      <FileStack className="h-3.5 w-3.5 text-neutral-500" />
                      <span className="truncate font-medium">{asset.name}</span>
                      <span className="text-xs text-neutral-500">{formatBytes(asset.size_bytes)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <label className="block">
              <span className="text-sm font-semibold text-white">Anything else we should know?</span>
              <Textarea
                rows={4}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="We have stats back to 2014, but the early seasons are only PDFs. Champions are on a separate WordPress site."
                className="mt-2 border-white/10 bg-black/20 text-white placeholder:text-neutral-500"
              />
            </label>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-5">
        <div>
          {currentStepIndex > 0 && (
            <button
              type="button"
              onClick={goBack}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/[0.06]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </button>
          )}
        </div>
        <div className="flex gap-3">
          {step === 'review' ? (
            <button
              type="button"
              onClick={submit}
              disabled={isPending || scope.length === 0}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-5 py-3 text-sm font-semibold text-cyan-100 transition-all hover:-translate-y-0.5 hover:border-cyan-200/40 hover:bg-cyan-400/15 disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Send migration request
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              disabled={!canProceed() || isPending}
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-300/30 bg-cyan-400/10 px-4 py-3 text-sm font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/15 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
