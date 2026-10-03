'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Check,
  CircleHelp,
  Loader2,
  Shield,
  SquarePen,
  Trophy,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { HomepageWeeklyGames } from '@/components/home/HomepageWeeklyGames';
import { CaptainLineupModalEditor } from '@/components/captain/CaptainLineupModalEditor';
import { SubInviteModal } from '@/components/captain/SubInviteModal';
import { TeamLineupView } from '@/components/team/TeamLineupView';
import { buildLineupDisplay } from '@/lib/lineups/types';
import {
  getCaptainGameDayData,
  lockCaptainGameAttendance,
  updateCaptainGameAttendanceStatus,
  type CaptainAttendanceStatus,
  type CaptainGameDayData,
  type GameDayAttendancePlayer,
} from '@/lib/actions/game-day';
import { startCaptainScoring } from '@/lib/actions/scorekeeper';

type CaptainGameDayPageProps = {
  leagueSlug: string;
  requestedGameId: string;
  teamId: string;
  canManage: boolean;
  initialData: CaptainGameDayData | null;
  initialOpenLineupEditor?: boolean;
};

export function CaptainGameDayPage({
  leagueSlug,
  requestedGameId,
  teamId,
  canManage,
  initialData,
  initialOpenLineupEditor = false,
}: CaptainGameDayPageProps) {
  const router = useRouter();
  const [data, setData] = useState<CaptainGameDayData | null>(initialData);
  const [isLoading, setIsLoading] = useState(!initialData);
  const [error, setError] = useState<string | null>(null);
  const [showLineupEditor, setShowLineupEditor] = useState(initialOpenLineupEditor);
  const [showAttendanceEditor, setShowAttendanceEditor] = useState(false);
  const [showSubInvite, setShowSubInvite] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [startingScore, startScoreTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;

    async function loadGameDay() {
      if (!canManage) {
        setIsLoading(false);
        return;
      }

      if (refreshToken === 0 && initialData) {
        setData(initialData);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      const result = await getCaptainGameDayData(teamId, requestedGameId);
      if (cancelled) return;

      if (!result.success) {
        setError(result.error);
        setData(null);
        setIsLoading(false);
        return;
      }

      setData(result.data);
      setIsLoading(false);

      if (result.data?.resolvedGameId && result.data.resolvedGameId !== requestedGameId) {
        router.replace(`/${leagueSlug}/captain/lineups/${result.data.resolvedGameId}`);
      }
    }

    loadGameDay();
    return () => {
      cancelled = true;
    };
  }, [canManage, initialData, leagueSlug, requestedGameId, router, teamId, refreshToken]);

  // "Our Lineup" reflects the captain's placed/published lineup (the same source
  // the lineup editor renders), NOT raw attendance — otherwise a just-set lineup
  // would not show here. Availability is layered on top only to colour players.
  const { skaters, goalies } = data?.lineup?.layout
    ? buildLineupDisplay(data.lineup.layout)
    : { skaters: [], goalies: [] };

  const availabilityMap = Object.fromEntries(
    (data?.attendance ?? [])
      .filter((player) => player.status === 'confirmed' || player.status === 'tentative' || player.status === 'out')
      .map((player) => [player.playerId, player.status]),
  ) as Record<string, 'confirmed' | 'tentative' | 'out'>;

  const eligibleForLineupCount = skaters.length + goalies.length;
  const snapshotExtendedGrid = eligibleForLineupCount > 11;
  const snapshotForwardSlots = snapshotExtendedGrid ? 9 : 6;
  const snapshotDefenceSlots = snapshotExtendedGrid ? 6 : 4;
  const missingRegularPlayers = (data?.attendance ?? [])
    .filter((player) => !player.isSub && player.status === 'out')
    .map((player) => ({
      playerId: player.playerId,
      fullName: player.fullName,
      jerseyNumber: player.jerseyNumber,
    }));

  const refreshData = () => setRefreshToken((current) => current + 1);

  const handleStartScoring = () => {
    if (!data?.resolvedGameId || !data.scoreSelfEnabled) return;

    startScoreTransition(async () => {
      const result = await startCaptainScoring(data.resolvedGameId!, teamId);
      if (result.success && result.gameId) {
        // Session cookie is set server-side, so go straight to the scoring surface.
        router.push(`/${result.leagueSlug ?? leagueSlug}/scorekeeper/game/${result.gameId}`);
        return;
      }

      window.alert(result.error || 'Failed to start scoring session.');
    });
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="space-y-4 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-[var(--league-primary)]" />
          <p className="text-[var(--color-text-secondary)]">Loading Game Day...</p>
        </div>
      </div>
    );
  }

  if (!canManage) {
    return (
        <CaptainMessage
          leagueSlug={leagueSlug}
          icon={<Shield className="mx-auto h-10 w-10 text-amber-300" />}
        title="Captain access required"
        body="Only captains and alternate captains can manage Game Day."
      />
    );
  }

  if (error) {
    return (
        <CaptainMessage
          leagueSlug={leagueSlug}
          icon={<AlertCircle className="mx-auto h-10 w-10 text-amber-300" />}
        title="Could not load Game Day"
        body={error}
      />
    );
  }

  if (!data || !data.game) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Link
          href={`/${leagueSlug}/captain`}
          className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Captain dashboard
        </Link>

        <div className="mt-6 rounded-[30px] border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-[0_30px_80px_-48px_rgba(0,0,0,0.75)]">
          <CalendarDays className="mx-auto h-12 w-12 text-[var(--league-primary)]" />
          <h1 className="mt-4 text-3xl font-black tracking-tight text-[var(--color-text-primary)]">
            Game Day
          </h1>
          <p className="mt-3 text-sm leading-6 text-[var(--color-text-secondary)]">
            No active or upcoming game is available for this team right now.
          </p>
        </div>
      </div>
    );
  }

  const currentData = data;
  const currentGame = currentData.game!;
  const teamPrimaryColor =
    currentGame.home_team?.id === teamId
      ? (currentGame.home_team?.colors ?? '#0f172a')
      : (currentGame.away_team?.colors ?? '#0f172a');
  const teamSecondaryColor = '#f8fafc';

  return (
    <>
      <div className="mx-auto max-w-6xl px-4 py-8">
        <Link
          href={`/${leagueSlug}/captain`}
          className="inline-flex items-center gap-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Captain dashboard
        </Link>

        <div className="mt-5 space-y-8">
          <section className="space-y-5">
            <div className="text-center">
              <h1 className="text-[2.6rem] font-black uppercase tracking-[0.08em] text-[var(--color-text-primary)] drop-shadow-[0_12px_40px_rgba(0,0,0,0.55)] sm:text-5xl">
                Game Day
              </h1>
            </div>

            <div className="relative z-40 grid grid-cols-2 gap-3 md:grid-cols-4">
              <ActionTile
                icon={<SquarePen className="h-5 w-5" />}
                title="Set Lineup"
                onClick={() => setShowLineupEditor(true)}
              />
              <ActionTile
                icon={<Users className="h-5 w-5" />}
                title="Edit Attendance"
                onClick={() => setShowAttendanceEditor(true)}
              />
              <ActionTile
                icon={<UserPlus className="h-5 w-5" />}
                title="Invite Sub"
                onClick={() => setShowSubInvite(true)}
              />
              <ActionTile
                icon={<Trophy className="h-5 w-5" />}
                title="Score Game"
                onClick={handleStartScoring}
                disabled={Boolean(currentData.scoreDisabledReason) || startingScore}
              />
            </div>
          </section>

          <section>
            <HomepageWeeklyGames
              games={[currentGame]}
              leagueSlug={leagueSlug}
              timezone={currentData.leagueTimezone}
              backgroundPreset="weekly-games"
              title="Game Card"
              emptyTitle=""
              emptyDescription=""
              showViewToggle={false}
              hideTitle
              variant="team"
              teamActions={<GameDayCountTiles counts={currentData.counts} />}
            />
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-2.5 text-[var(--league-primary)] shadow-[0_18px_40px_-28px_rgba(0,0,0,0.9)] backdrop-blur-xl">
                <JerseyIcon className="h-5 w-5" />
              </div>
              <h2 className="text-2xl font-black tracking-tight text-[var(--color-text-primary)] md:text-3xl">
                Our Lineup
              </h2>
            </div>
            <div className="rounded-[30px] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[0_28px_70px_-46px_rgba(0,0,0,0.8)] md:p-7">
              <TeamLineupView
                skaters={skaters}
                goalies={goalies}
                primaryColor={teamPrimaryColor}
                secondaryColor={teamSecondaryColor}
                availabilityMap={availabilityMap}
                forwardSlots={snapshotForwardSlots}
                defenceSlots={snapshotDefenceSlots}
              />
            </div>
          </section>
        </div>
      </div>

      <Overlay
        open={showLineupEditor}
        onClose={() => {
          setShowLineupEditor(false);
          refreshData();
        }}
        title="Set Lineup"
      >
        <CaptainLineupModalEditor
          leagueSlug={leagueSlug}
          gameId={currentData.resolvedGameId!}
          teamId={teamId}
          initialLayout={currentData.lineup.layout}
          initialStatus={currentData.lineup.status}
          primaryColor={teamPrimaryColor}
          secondaryColor={teamSecondaryColor}
        />
      </Overlay>

      <AttendanceEditorModal
        open={showAttendanceEditor}
        onClose={() => {
          setShowAttendanceEditor(false);
          refreshData();
        }}
        leagueSlug={leagueSlug}
        gameId={currentData.resolvedGameId!}
        teamId={teamId}
        players={currentData.attendance}
        attendanceLocked={currentData.attendanceLocked}
        attendanceLockedAt={currentData.attendanceLockedAt}
      />

      <SubInviteModal
        isOpen={showSubInvite}
        onClose={() => {
          setShowSubInvite(false);
          refreshData();
        }}
        gameId={currentData.resolvedGameId!}
        teamId={teamId}
        leagueId={currentData.leagueId}
        roster={currentData.rosterPlayerIds.map((playerId) => ({
          id: playerId,
          player_id: playerId,
          jersey_number: null,
          position: null,
          leadership_role: null,
          player_type: 'regular' as const,
          profile: null,
        }))}
        missingPlayers={missingRegularPlayers}
      />

    </>
  );
}

function CaptainMessage({
  leagueSlug,
  icon,
  title,
  body,
}: {
  leagueSlug: string;
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="rounded-[28px] border border-amber-400/20 bg-amber-400/10 p-6 text-center">
        {icon}
        <h1 className="mt-4 text-2xl font-black text-white">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-amber-100/85">{body}</p>
        <Link
          href={`/${leagueSlug}/captain`}
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-4 py-2 text-sm font-semibold text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to captain dashboard
        </Link>
      </div>
    </div>
  );
}

function JerseyIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M5 5 L8.5 3 Q12 6 15.5 3 L19 5 L22 8 L20.5 11 L18.5 10 L18.5 21 Q12 22 5.5 21 L5.5 10 L3.5 11 L2 8 Z" />
    </svg>
  );
}

function GameDayCountTiles({
  counts,
}: {
  counts: CaptainGameDayData['counts'];
}) {
  const items = [
    { label: 'In', value: counts.in, tone: 'emerald' },
    { label: 'Out', value: counts.out, tone: 'rose' },
    { label: 'Unsure', value: counts.unsure, tone: 'amber' },
    { label: 'Subs', value: counts.subs, tone: 'cyan' },
  ] as const;

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className={`rounded-2xl border px-3 py-3 text-center ${buildCountTone(item.tone)}`}
        >
          <p className="text-xl font-black tracking-tight">{item.value}</p>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

function buildCountTone(tone: 'emerald' | 'rose' | 'amber' | 'cyan') {
  if (tone === 'emerald') return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
  if (tone === 'rose') return 'border-rose-400/20 bg-rose-400/10 text-rose-300';
  if (tone === 'amber') return 'border-amber-400/20 bg-amber-400/10 text-amber-300';
  return 'border-cyan-400/20 bg-cyan-400/10 text-cyan-300';
}

function ActionTile({
  icon,
  title,
  onClick,
  disabled = false,
}: {
  icon: ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative z-40 min-h-[108px] rounded-[24px] border px-4 py-3 text-center transition-all backdrop-blur-xl ${
        disabled
          ? 'cursor-not-allowed border-white/5 bg-slate-950/45 text-slate-500'
          : 'border-white/10 bg-white/[0.05] text-[var(--color-text-primary)] shadow-[0_28px_70px_-46px_rgba(0,0,0,0.88)] hover:border-[var(--league-primary)]/35 hover:bg-white/[0.08]'
      }`}
    >
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <div className={`rounded-[20px] border p-3 ${disabled ? 'border-white/5 bg-slate-900/70 text-slate-500' : 'border-white/10 bg-black/20 text-[var(--league-primary)]'}`}>
          {icon}
        </div>
        <p className="text-sm font-black uppercase tracking-[0.12em] sm:text-base">{title}</p>
      </div>
    </button>
  );
}

function AttendanceStatusBadge({ status }: { status: CaptainAttendanceStatus }) {
  const config =
    status === 'confirmed'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300'
      : status === 'out'
        ? 'border-rose-400/20 bg-rose-400/10 text-rose-300'
        : status === 'tentative'
          ? 'border-amber-400/20 bg-amber-400/10 text-amber-300'
          : 'border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-secondary)]';

  const label =
    status === 'confirmed' ? 'In' : status === 'out' ? 'Out' : status === 'tentative' ? 'Unsure' : 'No Response';

  return (
    <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${config}`}>
      {label}
    </span>
  );
}

function Overlay({
  open,
  onClose,
  title,
  children,
  fullScreen = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  fullScreen?: boolean;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- mounted gates client-only portal rendering.
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] isolate">
      <div className="absolute inset-0 bg-black/78 backdrop-blur-md transition-opacity" onClick={onClose} />
      <div className="relative flex min-h-full items-center justify-center px-3 py-6 sm:px-4">
        <div className={`${fullScreen ? 'h-[min(92vh,980px)] w-full max-w-6xl' : 'w-full max-w-3xl'} relative`}>
          <div className="pointer-events-none absolute -inset-3 rounded-[38px] bg-[var(--league-primary)]/12 blur-2xl" />
          <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[var(--color-surface)] shadow-[0_40px_120px_-38px_rgba(0,0,0,0.95)]">
            <div className="flex items-center justify-between gap-3 border-b border-white/8 bg-black/25 px-5 py-4 backdrop-blur-sm sm:px-6">
              <div className="rounded-full border border-white/10 bg-black/35 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-white/80">
                {title}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/10 bg-black/35 p-2 text-white transition-colors hover:bg-black/60"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className={fullScreen ? 'max-h-[calc(92vh-72px)] overflow-y-auto bg-[var(--color-background)]' : 'max-h-[calc(92vh-72px)] overflow-y-auto bg-[var(--color-surface)] p-5 sm:p-6'}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function AttendanceEditorModal({
  open,
  onClose,
  leagueSlug,
  gameId,
  teamId,
  players,
  attendanceLocked,
  attendanceLockedAt,
}: {
  open: boolean;
  onClose: () => void;
  leagueSlug: string;
  gameId: string;
  teamId: string;
  players: GameDayAttendancePlayer[];
  attendanceLocked: boolean;
  attendanceLockedAt: string | null;
}) {
  const [rows, setRows] = useState(players);
  const [savingPlayerId, setSavingPlayerId] = useState<string | null>(null);
  const [locking, startLocking] = useTransition();
  const [locked, setLocked] = useState(attendanceLocked);
  const [lockedAt, setLockedAt] = useState<string | null>(attendanceLockedAt);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(players);
  }, [players]);

  useEffect(() => {
    setLocked(attendanceLocked);
    setLockedAt(attendanceLockedAt);
  }, [attendanceLocked, attendanceLockedAt]);

  if (!open) return null;

  const handleLockAttendance = () => {
    if (locking || locked) return;
    setError(null);
    startLocking(async () => {
      const result = await lockCaptainGameAttendance({
        gameId,
        teamId,
        leagueSlug,
      });

      if (!result.success) {
        setError(result.error || 'Could not lock attendance.');
        return;
      }

      const now = new Date().toISOString();
      setLocked(true);
      setLockedAt(now);
    });
  };

  const setStatus = async (playerId: string, status: CaptainAttendanceStatus) => {
    const previous = rows;
    setError(null);
    setSavingPlayerId(playerId);
    setRows((current) =>
      current.map((player) =>
        player.playerId === playerId ? { ...player, status } : player,
      ),
    );

    const result = await updateCaptainGameAttendanceStatus({
      gameId,
      teamId,
      playerId,
      status,
      leagueSlug,
    });

    if (!result.success) {
      setRows(previous);
      setError(result.error || 'Could not update attendance.');
    } else {
      setLocked(false);
      setLockedAt(null);
    }

    setSavingPlayerId(null);
  };

  return (
    <Overlay open={open} onClose={onClose} title="Edit Attendance">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-6 text-[var(--color-text-secondary)]">
            Update attendance for the current game. Tap an icon to change each player instantly.
          </p>
          <button
            type="button"
            onClick={handleLockAttendance}
            disabled={locking || locked}
            className={`inline-flex items-center justify-center rounded-xl border px-4 py-2 text-xs font-black uppercase tracking-[0.14em] transition-colors ${
              locked
                ? 'border-emerald-400/30 bg-emerald-400/14 text-emerald-300'
                : 'border-[var(--league-primary)]/30 bg-[var(--league-primary)]/12 text-[var(--league-primary)] hover:bg-[var(--league-primary)]/18 disabled:cursor-not-allowed disabled:opacity-60'
            }`}
          >
            {locking ? 'Locking...' : locked ? 'Attendance Locked' : 'Lock Attendance'}
          </button>
        </div>
        {locked ? (
          <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">
            Attendance is locked for scorekeeping{lockedAt ? '.' : '.'}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </div>
        ) : null}
        <div className="max-h-[65vh] space-y-3 overflow-y-auto pr-1">
          {rows.map((player) => (
            <div
              key={player.playerId}
              className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-background)]/60 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
                      {player.jerseyNumber ? `#${player.jerseyNumber} ` : ''}
                      {player.fullName}
                    </p>
                    {player.isSub ? (
                      <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-300">
                        Sub
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {player.position || 'Skater'}
                  </p>
                </div>
                {savingPlayerId === player.playerId ? (
                  <Loader2 className="h-4 w-4 animate-spin text-[var(--league-primary)]" />
                ) : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {([
                  {
                    status: 'confirmed' as CaptainAttendanceStatus,
                    label: 'In',
                    icon: Check,
                    active: 'border-emerald-400/30 bg-emerald-400/14 text-emerald-300',
                  },
                  {
                    status: 'out' as CaptainAttendanceStatus,
                    label: 'Out',
                    icon: X,
                    active: 'border-rose-400/30 bg-rose-400/14 text-rose-300',
                  },
                  {
                    status: 'tentative' as CaptainAttendanceStatus,
                    label: 'Unsure',
                    icon: CircleHelp,
                    active: 'border-amber-400/30 bg-amber-400/14 text-amber-300',
                  },
                ]).map(({ status, label, icon: Icon, active }) => (
                  <button
                    key={status}
                    type="button"
                    disabled={savingPlayerId === player.playerId}
                    onClick={() => setStatus(player.playerId, status)}
                    aria-label={label}
                    title={label}
                    className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border transition-colors ${
                      player.status === status
                        ? active
                        : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                ))}
                <button
                  type="button"
                  disabled={savingPlayerId === player.playerId}
                  onClick={() => setStatus(player.playerId, 'no_response')}
                  aria-label="No response"
                  title="No response"
                  className={`inline-flex min-w-[96px] items-center justify-center rounded-xl border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
                    player.status === 'no_response'
                      ? 'border-slate-400/30 bg-slate-400/12 text-slate-200'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
                  }`}
                >
                  No response
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Overlay>
  );
}
