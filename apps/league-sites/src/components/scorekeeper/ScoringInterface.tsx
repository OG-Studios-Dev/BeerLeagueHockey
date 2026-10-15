'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import type {
  GameData,
  GameEventData,
  CheckinPlayer,
  ScorekeeperSession,
} from '@/lib/actions/scorekeeper';
import { undoEvent, toggleGoaliePull, updateGameStatus, saveScorekeeperNotes, refreshGameEvents, syncTimerState } from '@/lib/actions/scorekeeper';
import { useGameTimer } from '@/hooks/useGameTimer';
import type { TimerSyncState } from '@/hooks/useGameTimer';
import { PreGameCheckin } from './PreGameCheckin';
import { EmptyNetTracker } from '@/lib/scorekeeper/empty-net-tracker';
import { buildPenaltyTrackerFromEvents } from '@/lib/scorekeeper/event-replay';
import { GameTimer } from './GameTimer';
import { PenaltyBox } from './PenaltyBox';
import { GoalEntry } from './GoalEntry';
import { PenaltyEntry } from './PenaltyEntry';
import { ShotEntry } from './ShotEntry';
import { ScoreSheetUpload } from './ScoreSheetUpload';
import { GameSummaryModal, getAttendanceReviewWarnings } from './GameSummaryModal';
import { SyncStatusBanner, useOnlineStatus } from './SyncStatusBanner';
import { EventEditModal } from './EventEditModal';
import { OFFLINE_ACTION_ERROR } from './ui-reliability';

function isGoaliePosition(position: string | null | undefined): boolean {
  if (!position) return false;
  const normalized = position.trim().toLowerCase();
  return normalized === 'goalie' || normalized === 'g';
}

interface ScoringInterfaceProps {
  game: GameData;
  events: GameEventData[];
  leagueSlug: string;
  session: ScorekeeperSession;
  checkins?: { homeTeam: CheckinPlayer[]; awayTeam: CheckinPlayer[] };
}

type ActiveEntry = null | {
  type: 'goal' | 'penalty' | 'shot';
  teamType: 'home' | 'away';
};

export function ScoringInterface({
  game: initialGame,
  events: initialEvents,
  leagueSlug,
  session,
  checkins,
}: ScoringInterfaceProps) {
  const router = useRouter();
  const [game, setGame] = useState(initialGame);
  const [events, setEvents] = useState(initialEvents);
  const [activeEntry, setActiveEntry] = useState<ActiveEntry>(null);
  const [editingEvent, setEditingEvent] = useState<GameEventData | null>(null);

  // Refetch events and score from server (no session check — lightweight)
  const refreshData = useCallback(async () => {
    try {
      const result = await refreshGameEvents(game.id);
      if (result.success) {
        if (result.events) {
          setEvents(result.events);
        }
        if (result.homeScore !== undefined || result.awayScore !== undefined) {
          setGame(prev => ({
            ...prev,
            homeScore: result.homeScore ?? prev.homeScore,
            awayScore: result.awayScore ?? prev.awayScore,
          }));
        }
      } else {
        console.error('refreshData failed:', result.error);
      }
    } catch (err) {
      console.error('Failed to refresh game data:', err);
    }
  }, [game.id]);
  const [selectedTeam, setSelectedTeam] = useState<'home' | 'away' | null>(null);
  const [activePeriodTab, setActivePeriodTab] = useState<number | 'all'>('all');
  const [showScoreSheetUpload, setShowScoreSheetUpload] = useState(false);
  const [showGameSummary, setShowGameSummary] = useState(false);
  const [notes, setNotes] = useState(initialGame.scorekeeperNotes || '');
  const [showNotes, setShowNotes] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [shotMode, setShotMode] = useState<'simple' | 'advanced'>('simple');
  const [eventsCollapsed, setEventsCollapsed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const isOnline = useOnlineStatus();
  const attendanceWarnings = useMemo(
    () => getAttendanceReviewWarnings(checkins, events),
    [checkins, events],
  );

  const requireOnline = useCallback(() => {
    if (isOnline) return true;
    setActionError(OFFLINE_ACTION_ERROR);
    return false;
  }, [isOnline]);

  // Lift game timer into ScoringInterface for live time values
  const handleTimerSync = useCallback(
    (state: TimerSyncState) => {
      if (!isOnline) return;
      syncTimerState(game.id, state).catch(console.error);
    },
    [game.id, isOnline]
  );

  const tracksTimePeriods = game.scorekeeperTracksTimePeriods;

  const timer = useGameTimer({
    periodLengthMinutes: game.periodLengthMinutes,
    periodCount: game.periodCount,
    initialPeriod: game.currentPeriod,
    initialElapsedSeconds: game.timerElapsedSeconds,
    initialRunning: game.timerRunning,
    onSync: handleTimerSync,
    syncIntervalMs: 30000,
  });

  // Initialize auto-detection trackers
  const penaltyTracker = useMemo(() => {
    return buildPenaltyTrackerFromEvents(
      events.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        teamType: event.teamType,
        playerId: event.playerId,
        period: event.period,
        gameTimeSeconds: event.gameTimeSeconds,
        penaltyMinutes: event.penaltyMinutes,
        penaltyType: event.penaltyType,
        deletedAt: event.deletedAt,
        createdAt: event.createdAt,
      })),
      game.periodLengthMinutes
    );
  }, [events, game.periodLengthMinutes]);

  const emptyNetTracker = useMemo(() => {
    const tracker = new EmptyNetTracker();
    tracker.setState({
      home: game.homeGoaliePulled,
      away: game.awayGoaliePulled,
    });
    return tracker;
  }, [game.homeGoaliePulled, game.awayGoaliePulled]);

  // Compute scores from events (more reliable than server-cached values)
  const activeGoals = events.filter(e => e.eventType === 'goal' && !e.deletedAt);
  const homeScore = activeGoals.filter(e => e.teamType === 'home').length;
  const awayScore = activeGoals.filter(e => e.teamType === 'away').length;

  // Filtered events for timeline
  const filteredEvents = useMemo(() => {
    const active = events.filter(e => !e.deletedAt);
    if (!tracksTimePeriods || activePeriodTab === 'all') return active;
    return active.filter(e => e.period === activePeriodTab);
  }, [events, activePeriodTab, tracksTimePeriods]);

  const handleEntryComplete = useCallback(() => {
    setActiveEntry(null);
    setSelectedTeam(null);
    refreshData();
  }, [refreshData]);

  async function handleUndo(eventId: string) {
    if (!requireOnline()) return;
    try {
      const result = await undoEvent(eventId);
      if (result.success) {
        setActionError(null);
        setEvents(prev => prev.map(e =>
          e.id === eventId ? { ...e, deletedAt: new Date().toISOString() } : e
        ));
        refreshData();
      } else {
        setActionError(result.error || 'Failed to undo event');
      }
    } catch {
      setActionError('Failed to undo event. Your event list was not changed.');
    }
  }

  async function handleGoaliePull(teamType: 'home' | 'away') {
    if (!requireOnline()) return;
    try {
      const result = await toggleGoaliePull(game.id, teamType);
      if (result.success) {
        setActionError(null);
        setGame(prev => ({
          ...prev,
          homeGoaliePulled: teamType === 'home' ? (result.pulled ?? false) : prev.homeGoaliePulled,
          awayGoaliePulled: teamType === 'away' ? (result.pulled ?? false) : prev.awayGoaliePulled,
        }));
        return;
      }
      setActionError(result.error || 'Failed to update goalie state');
    } catch {
      setActionError('Failed to update goalie state');
    }
  }

  async function handleStartGame() {
    if (!requireOnline()) return;
    try {
      const result = await updateGameStatus(game.id, 'in_progress');
      if (result.success) {
        setActionError(null);
        setGame(prev => ({ ...prev, status: 'in_progress' }));
        return;
      }
      setActionError(result.error || 'Failed to start game');
    } catch {
      setActionError('Failed to start game');
    }
  }

  // Determine auto-flags for current goal entry (live timer values)
  const isPP = tracksTimePeriods && selectedTeam
    ? penaltyTracker.isPowerPlay(selectedTeam, timer.timeRemaining, timer.currentPeriod)
    : false;
  const isSH = tracksTimePeriods && selectedTeam
    ? penaltyTracker.isShortHanded(selectedTeam, timer.timeRemaining, timer.currentPeriod)
    : false;
  const isEN = selectedTeam
    ? emptyNetTracker.isEmptyNetGoal(selectedTeam)
    : false;

  // Quick save handler for simple shot mode (tap goalie = save)
  const handleQuickSave = useCallback(async (
    defendingTeamId: string,
    defendingTeamType: 'home' | 'away',
    goalieId: string
  ) => {
    if (!requireOnline()) return;
    try {
      const { addShotEvent } = await import('@/lib/actions/scorekeeper');
      const result = await addShotEvent({
        gameId: game.id,
        teamId: defendingTeamId,
        teamType: defendingTeamType,
        goalieId,
        period: tracksTimePeriods ? timer.currentPeriod : null,
        gameTimeSeconds: tracksTimePeriods ? timer.timeRemaining : null,
      });
      if (!result.success) {
        setActionError(result.error || 'Failed to record save');
        return;
      }
      setActionError(null);
      refreshData();
    } catch (err) {
      console.error('Quick save failed:', err);
      setActionError('Failed to record save');
    }
  }, [game.id, tracksTimePeriods, timer.currentPeriod, timer.timeRemaining, refreshData, requireOnline]);

  const homeTeam = game.homeTeam;
  const awayTeam = game.awayTeam;
  const activeTeam = selectedTeam === 'home' ? homeTeam : awayTeam;
  const opposingTeam = selectedTeam === 'home' ? awayTeam : homeTeam;

  // Show pre-game check-in when game hasn't started yet and attendance still needs confirmation.
  if (game.status === 'scheduled' && checkins) {
    return (
      <PreGameCheckin
        game={game}
        checkins={checkins}
        onGameStarted={() => setGame(prev => ({ ...prev, status: 'in_progress' }))}
      />
    );
  }

  return (
    <div className="flex flex-col min-h-screen">
      {/* Sync Status */}
      <div className="px-4 pt-2">
        <SyncStatusBanner syncState={{ isOnline, isSyncing: false, pendingCount: 0, lastError: null, lastSyncAt: null }} />
        {actionError && (
          <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {actionError}
          </div>
        )}
      </div>

      {/* Top Bar: Back + Multi-game nav */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--color-border)]">
        {session.sessionType === 'multi' ? (
          <button
            onClick={() => router.push(`/${leagueSlug}/scorekeeper`)}
            className="flex items-center gap-1 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Games
          </button>
        ) : (
          <div />
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--color-text-secondary)]">
            {game.status === 'in_progress' ? 'LIVE' : game.status.toUpperCase()}
          </span>
          <button
            onClick={() => setShowGameSummary(true)}
            className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface)] transition-colors"
            aria-label="Game summary"
            title="View game summary"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
            </svg>
          </button>
          <div className="relative">
            <button
              onClick={() => setShowNotes(true)}
              className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface)] transition-colors"
              aria-label="Game notes"
              title="Game notes"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
              {notes && (
                <span className="absolute top-0 right-0 w-2 h-2 rounded-full bg-[var(--league-primary,#d4af37)]" />
              )}
            </button>
          </div>
          <button
            onClick={() => setShowScoreSheetUpload(true)}
            className="p-1.5 rounded-lg text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface)] transition-colors"
            aria-label="Upload score sheet"
            title="Upload score sheet photo"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Scoreboard + Action Buttons — Full-width scoring panel */}
      <div className="px-3 py-4 border-b border-[var(--color-border)]">
        <div className="flex items-stretch gap-2 max-w-lg mx-auto">
          {/* ===== HOME SIDE ===== */}
          <TeamPanel
            team={homeTeam}
            teamType="home"
            score={homeScore}
            goaliePulled={game.homeGoaliePulled}
            shotMode={shotMode}
            saves={events.filter(e => e.eventType === 'save' && e.teamType === 'home' && !e.deletedAt).length}
            disabled={game.status !== 'in_progress' || !isOnline}
            onGoal={() => { setSelectedTeam('home'); setActiveEntry({ type: 'goal', teamType: 'home' }); }}
            onPenalty={() => { setSelectedTeam('home'); setActiveEntry({ type: 'penalty', teamType: 'home' }); }}
            onShot={() => { setSelectedTeam('home'); setActiveEntry({ type: 'shot', teamType: 'home' }); }}
            onQuickSave={(goalieId) => handleQuickSave(homeTeam.id, 'home', goalieId)}
            onGoaliePull={() => handleGoaliePull('home')}
          />

          {/* ===== CENTER: Score + Timer ===== */}
          <div className="flex flex-col items-center justify-center gap-1 px-1 min-w-[60px]">
            <div className="text-xs font-medium text-[var(--color-text-secondary)] uppercase">vs</div>
            {/* Shot Mode Toggle */}
            <button
              onClick={() => setShotMode(prev => prev === 'simple' ? 'advanced' : 'simple')}
              disabled={!isOnline}
              className="text-[9px] font-medium px-1.5 py-0.5 rounded transition-colors text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border)]"
              title={shotMode === 'simple' ? 'Simple: Tap goalie for saves' : 'Advanced: Select shooter for shots'}
            >
              {shotMode === 'simple' ? 'Simple' : 'Adv'}
            </button>
          </div>

          {/* ===== AWAY SIDE ===== */}
          <TeamPanel
            team={awayTeam}
            teamType="away"
            score={awayScore}
            goaliePulled={game.awayGoaliePulled}
            shotMode={shotMode}
            saves={events.filter(e => e.eventType === 'save' && e.teamType === 'away' && !e.deletedAt).length}
            disabled={game.status !== 'in_progress' || !isOnline}
            onGoal={() => { setSelectedTeam('away'); setActiveEntry({ type: 'goal', teamType: 'away' }); }}
            onPenalty={() => { setSelectedTeam('away'); setActiveEntry({ type: 'penalty', teamType: 'away' }); }}
            onShot={() => { setSelectedTeam('away'); setActiveEntry({ type: 'shot', teamType: 'away' }); }}
            onQuickSave={(goalieId) => handleQuickSave(awayTeam.id, 'away', goalieId)}
            onGoaliePull={() => handleGoaliePull('away')}
          />
        </div>
      </div>

      {/* Officials Strip */}
      {game.officials && game.officials.length > 0 && (
        <div className="px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50">
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
            </svg>
            <span className="font-medium">Officials:</span>
            <span className="truncate">
              {game.officials.map(o => `${o.name}${o.jerseyNumber ? ` #${o.jerseyNumber}` : ''} (${o.role})`).join(' · ')}
            </span>
          </div>
        </div>
      )}

      {/* Penalty Box - live timers between scoreboard and timer */}
      {tracksTimePeriods && (
        <PenaltyBox
          penaltyTracker={penaltyTracker}
          timeRemaining={timer.timeRemaining}
          currentPeriod={timer.currentPeriod}
          homeRoster={homeTeam.roster}
          awayRoster={awayTeam.roster}
          homeTeamColor={homeTeam.primaryColor}
          awayTeamColor={awayTeam.primaryColor}
        />
      )}

      {/* Timer Bar */}
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        {!tracksTimePeriods ? (
          <div className="text-center text-sm text-[var(--color-text-secondary)]">
            Time and periods are disabled for this league. Goals can be entered in any order.
          </div>
        ) : game.status === 'scheduled' ? (
          <div className="text-center">
            <button
              onClick={handleStartGame}
              disabled={!isOnline}
              className="px-6 py-2.5 rounded-xl bg-[var(--league-primary,#d4af37)] text-[var(--color-accent-text,#000)] font-semibold transition-all hover:opacity-90 active:scale-95"
            >
              Start Game
            </button>
          </div>
        ) : (
          <GameTimer
            timer={timer}
            periodCount={game.periodCount}
            disabled={!isOnline}
          />
        )}
      </div>

      {/* Event Timeline — Collapsible */}
      <div className="flex-1 overflow-y-auto">
        {/* Collapsible Header */}
        <div className="flex items-center justify-between w-full px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)]/50">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-[var(--color-text-primary)] uppercase tracking-wide">
              Events
            </span>
            <span className="text-[10px] text-[var(--color-text-secondary)] tabular-nums">
              ({filteredEvents.length})
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Period Tabs inline */}
            {tracksTimePeriods && !eventsCollapsed && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setActivePeriodTab('all'); }}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                    activePeriodTab === 'all'
                      ? 'bg-[var(--league-primary,#d4af37)]/10 text-[var(--league-primary,#d4af37)]'
                      : 'text-[var(--color-text-secondary)]'
                  }`}
                >
                  All
                </button>
                {Array.from({ length: game.periodCount }, (_, i) => i + 1).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setActivePeriodTab(p); }}
                    className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                      activePeriodTab === p
                        ? 'bg-[var(--league-primary,#d4af37)]/10 text-[var(--league-primary,#d4af37)]'
                        : 'text-[var(--color-text-secondary)]'
                    }`}
                  >
                    P{p}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => setEventsCollapsed(prev => !prev)}
              className="rounded-lg p-1 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text-primary)]"
              aria-expanded={!eventsCollapsed}
              aria-label={eventsCollapsed ? 'Expand events' : 'Collapse events'}
            >
              <svg
                className={`w-4 h-4 transition-transform ${eventsCollapsed ? '' : 'rotate-180'}`}
                fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>
          </div>
        </div>

        {/* Events List */}
        {!eventsCollapsed && (
          <div className="px-4 py-2">
            {filteredEvents.length === 0 ? (
              <div className="py-8 text-center text-sm text-[var(--color-text-secondary)]">
                No events recorded yet
              </div>
            ) : (
              <div className="space-y-1.5">
                {filteredEvents.map(event => (
                  <EventRow
                    key={event.id}
                    event={event}
                    homeTeamName={homeTeam.shortName || homeTeam.name}
                    awayTeamName={awayTeam.shortName || awayTeam.name}
                    homeTeamColor={homeTeam.primaryColor}
                    awayTeamColor={awayTeam.primaryColor}
                    onUndo={() => handleUndo(event.id)}
                    onEdit={isOnline ? () => setEditingEvent(event) : undefined}
                    actionsDisabled={!isOnline}
                    showTimePeriods={tracksTimePeriods}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Entry Modals */}
      {activeEntry?.type === 'goal' && activeTeam && selectedTeam && (
        <GoalEntry
          gameId={game.id}
          teamId={activeTeam.id}
          teamType={selectedTeam}
          teamName={activeTeam.name}
          teamColor={activeTeam.primaryColor}
          roster={activeTeam.roster}
          period={tracksTimePeriods ? timer.currentPeriod : null}
          gameTimeSeconds={tracksTimePeriods ? timer.timeRemaining : null}
          isPowerPlay={isPP}
          isShortHanded={isSH}
          isEmptyNet={isEN}
          opposingTeamName={opposingTeam.name}
          opposingRoster={opposingTeam.roster}
          isOnline={isOnline}
          onComplete={handleEntryComplete}
          onCancel={() => setActiveEntry(null)}
        />
      )}

      {activeEntry?.type === 'penalty' && activeTeam && selectedTeam && (
        <PenaltyEntry
          gameId={game.id}
          teamId={activeTeam.id}
          teamType={selectedTeam}
          teamName={activeTeam.name}
          teamColor={activeTeam.primaryColor}
          roster={activeTeam.roster}
          period={tracksTimePeriods ? timer.currentPeriod : null}
          gameTimeSeconds={tracksTimePeriods ? timer.timeRemaining : null}
          penaltyRules={game.penaltyRules}
          isOnline={isOnline}
          onComplete={handleEntryComplete}
          onCancel={() => setActiveEntry(null)}
        />
      )}

      {activeEntry?.type === 'shot' && selectedTeam && (
        <ShotEntry
          gameId={game.id}
          defendingTeamId={opposingTeam.id}
          defendingTeamType={selectedTeam === 'home' ? 'away' : 'home'}
          goalies={opposingTeam.roster.filter(p => isGoaliePosition(p.position))}
          shootingRoster={activeTeam!.roster}
          shootingTeamName={activeTeam!.name}
          shootingTeamColor={activeTeam!.primaryColor}
          period={tracksTimePeriods ? timer.currentPeriod : null}
          gameTimeSeconds={tracksTimePeriods ? timer.timeRemaining : null}
          isOnline={isOnline}
          onComplete={handleEntryComplete}
          onCancel={() => setActiveEntry(null)}
        />
      )}

      {/* Edit Event Modal */}
      {editingEvent && (
        <EventEditModal
          event={editingEvent}
          homeRoster={homeTeam.roster}
          awayRoster={awayTeam.roster}
          periodCount={game.periodCount}
          showTimePeriods={tracksTimePeriods}
          penaltyRules={game.penaltyRules}
          isOnline={isOnline}
          onSaved={() => {
            setEditingEvent(null);
            refreshData();
          }}
          onClose={() => setEditingEvent(null)}
        />
      )}

      {/* Score Sheet Upload Modal */}
      {showScoreSheetUpload && (
        <ScoreSheetUpload
          gameId={game.id}
          game={game}
          isOnline={isOnline}
          onComplete={() => {
            setShowScoreSheetUpload(false);
            refreshData();
          }}
          onClose={() => setShowScoreSheetUpload(false)}
        />
      )}

      {/* Game Summary Modal */}
      {showGameSummary && (
        <GameSummaryModal
          gameId={game.id}
          game={game}
          leagueSlug={leagueSlug}
          session={session}
          isOnline={isOnline}
          attendanceWarnings={attendanceWarnings}
          onClose={() => setShowGameSummary(false)}
        />
      )}

      {/* Notes Modal */}
      {showNotes && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowNotes(false)} />
          <div className="relative w-full max-w-md mx-4 mb-4 sm:mb-0 bg-[var(--color-background)] rounded-2xl border border-[var(--color-border)] animate-in slide-in-from-bottom duration-200">
            <div className="px-4 py-3 border-b border-[var(--color-border)]">
              <h3 className="font-semibold text-[var(--color-text-primary)]">Game Notes</h3>
              <p className="text-xs text-[var(--color-text-secondary)]">Notes are saved to the game record</p>
            </div>
            <div className="p-4">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about the game (injuries, disputes, ice conditions, etc.)..."
                className="w-full h-32 px-3 py-2 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-secondary)] resize-none focus:outline-none focus:ring-2 focus:ring-[var(--league-primary,#d4af37)]/50"
              />
            </div>
            <div className="flex gap-2 px-4 py-3 border-t border-[var(--color-border)]">
              <button
                onClick={() => setShowNotes(false)}
                className="flex-1 py-2.5 rounded-xl border border-[var(--color-border)] text-[var(--color-text-secondary)] text-sm font-medium hover:bg-[var(--color-surface)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  if (!requireOnline()) return;
                  setNoteSaving(true);
                  try {
                    const result = await saveScorekeeperNotes(game.id, notes);
                    if (!result.success) {
                      setActionError(result.error || 'Failed to save notes');
                      return;
                    }
                    setActionError(null);
                    setShowNotes(false);
                  } catch {
                    setActionError('Failed to save notes. Your text is still here.');
                  } finally {
                    setNoteSaving(false);
                  }
                }}
                disabled={noteSaving || !isOnline}
                className="flex-1 py-2.5 rounded-xl bg-[var(--league-primary,#d4af37)] text-[var(--color-accent-text,#000)] text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {noteSaving ? 'Saving...' : 'Save Notes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// EventRow sub-component
// =============================================================================

function EventRow({
  event,
  homeTeamName,
  awayTeamName,
  homeTeamColor,
  awayTeamColor,
  onUndo,
  onEdit,
  actionsDisabled = false,
  showTimePeriods = true,
}: {
  event: GameEventData;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamColor?: string | null;
  awayTeamColor?: string | null;
  onUndo: () => void;
  onEdit?: () => void;
  actionsDisabled?: boolean;
  showTimePeriods?: boolean;
}) {
  const canEdit = onEdit && (event.eventType === 'goal' || event.eventType === 'penalty');
  const teamName = event.teamType === 'home' ? homeTeamName : awayTeamName;

  const timeDisplay = event.gameTimeSeconds != null
    ? `${Math.floor(event.gameTimeSeconds / 60)}:${(event.gameTimeSeconds % 60).toString().padStart(2, '0')}`
    : '';

  let icon: React.ReactNode;
  let bgColor: string;
  let title: string;
  let details: string | null = null;

  switch (event.eventType) {
    case 'goal':
      icon = (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
      bgColor = 'bg-green-500/10 text-green-400';
      title = 'GOAL';
      if (event.assist1Name) {
        details = `Assists: #${event.assist1Number ?? '?'} ${event.assist1Name}`;
        if (event.assist2Name) {
          details += `, #${event.assist2Number ?? '?'} ${event.assist2Name}`;
        }
      }
      break;
    case 'penalty':
      icon = (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 2L2 22h20L12 2z" />
        </svg>
      );
      bgColor = 'bg-yellow-500/10 text-yellow-400';
      title = event.penaltyType ? `PENALTY - ${event.penaltyType}` : 'PENALTY';
      details = `${event.penaltyMinutes ?? 0} min`;
      break;
    case 'save':
      icon = (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
      bgColor = 'bg-blue-500/10 text-blue-400';
      title = 'SAVE';
      break;
    default:
      icon = null;
      bgColor = 'bg-gray-500/10 text-gray-400';
      title = event.eventType;
  }

  const teamColor = event.teamType === 'home' ? homeTeamColor : awayTeamColor;

  return (
    <div
      className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-[var(--color-surface)] group transition-colors border-l-2"
      style={{ borderLeftColor: teamColor || 'transparent' }}
    >
      {/* Icon */}
      <div className={`flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 ${bgColor}`}>
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="inline-flex min-w-9 items-center justify-center rounded-md px-1.5 py-1 text-sm font-black tabular-nums"
            style={{
              backgroundColor: teamColor ? `${teamColor}20` : 'var(--color-surface)',
              color: teamColor || 'var(--color-text-primary)',
            }}
          >
            {event.playerNumber ?? '—'}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-[var(--color-text-primary)]">
              {title}
            </div>
            <div className="truncate text-xs text-[var(--color-text-secondary)]">
              {event.playerName}
              {details ? ` • ${details}` : ''}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {showTimePeriods && event.period != null && (
            <span className="text-xs text-[var(--color-text-secondary)]">
              P{event.period} {timeDisplay}
            </span>
          )}
          <span className="text-xs text-[var(--color-text-secondary)]">
            {teamName}
          </span>
          {/* Flags */}
          {event.isPowerPlay && (
            <span className="text-[10px] font-bold text-yellow-400">PP</span>
          )}
          {event.isShortHanded && (
            <span className="text-[10px] font-bold text-blue-400">SH</span>
          )}
          {event.isEmptyNet && (
            <span className="text-[10px] font-bold text-purple-400">EN</span>
          )}
          {event.isGWG && (
            <span className="text-[10px] font-bold text-green-400">GWG</span>
          )}
        </div>
      </div>

      {/* Edit (goals & penalties only) */}
      {canEdit && (
        <button
          onClick={onEdit}
          className="flex-shrink-0 p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-[var(--league-primary,#d4af37)]/10 text-[var(--color-text-secondary)] hover:text-[var(--league-primary,#d4af37)] transition-all"
          aria-label="Edit event"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
          </svg>
        </button>
      )}

      {/* Undo */}
      <button
        onClick={onUndo}
        disabled={actionsDisabled}
        className="flex-shrink-0 p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-[var(--color-text-secondary)] hover:text-red-400 transition-all"
        aria-label="Undo event"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
        </svg>
      </button>
    </div>
  );
}

// =============================================================================
// SaveButton — clearly labeled save/shot button with goalie info
// =============================================================================

import type { PlayerData as GoaliePlayerData } from '@/lib/actions/scorekeeper';

function SaveButton({
  goalies,
  teamColor,
  pulled,
  shotMode,
  saves,
  disabled,
  onQuickSave,
  onAdvancedShot,
}: {
  goalies: GoaliePlayerData[];
  teamColor?: string | null;
  pulled: boolean;
  shotMode: 'simple' | 'advanced';
  saves: number;
  disabled: boolean;
  onQuickSave: (goalieId: string) => void;
  onAdvancedShot?: () => void;
}) {
  const starter = goalies[0];

  if (shotMode === 'advanced' && onAdvancedShot) {
    return (
      <button
        onClick={onAdvancedShot}
        disabled={disabled}
        className="w-full py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-30 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border border-blue-500/20"
      >
        + Shot ({saves})
      </button>
    );
  }

  // With multiple rostered goalies, require an explicit goalie pick for this save.
  if (goalies.length > 1 && onAdvancedShot) {
    return (
      <button
        onClick={onAdvancedShot}
        disabled={disabled || pulled}
        className="w-full py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-30 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25 border border-blue-500/20"
      >
        + Save · Select Goalie ({saves})
      </button>
    );
  }

  // Simple mode: big tappable save button with goalie identity
  if (!starter) {
    return (
      <div className="w-full py-2.5 rounded-xl text-xs font-bold text-center bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-secondary)] opacity-50">
        No Goalie
      </div>
    );
  }

  return (
    <button
      onClick={() => !pulled && onQuickSave(starter.id)}
      disabled={disabled || pulled}
      className={`w-full rounded-xl transition-all active:scale-95 disabled:opacity-30 border overflow-hidden ${
        pulled
          ? 'bg-purple-500/10 border-purple-500/20 opacity-50'
          : 'bg-blue-500/15 border-blue-500/20 hover:bg-blue-500/25'
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Goalie avatar */}
        <div className="relative flex-shrink-0">
          {starter.avatarUrl ? (
            <Image
              src={starter.avatarUrl}
              alt={starter.fullName}
              width={32}
              height={32}
              className="w-8 h-8 rounded-full object-cover border-2 border-blue-400/40"
            />
          ) : (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 border-blue-400/40"
              style={{
                backgroundColor: teamColor ? `${teamColor}20` : 'var(--color-surface)',
                color: teamColor || 'var(--color-text-primary)',
              }}
            >
              {starter.jerseyNumber}
            </div>
          )}
        </div>

        {/* Label */}
        <div className="flex-1 text-left min-w-0">
          <div className="text-xs font-bold text-blue-400">
            {pulled ? 'Empty Net' : '+ Save'}
          </div>
          <div className="text-[10px] text-blue-400/60 truncate">
            #{starter.jerseyNumber} {starter.fullName.split(' ').pop()}
          </div>
        </div>

        {/* Save count */}
        <div className="flex-shrink-0 text-right">
          <div className="text-sm font-mono font-bold tabular-nums text-blue-400">
            {saves}
          </div>
          <div className="text-[9px] text-blue-400/60 uppercase">SVS</div>
        </div>
      </div>
    </button>
  );
}

// =============================================================================
// TeamPanel — team logo, score, action buttons, and goalie in one panel
// =============================================================================

import type { TeamData } from '@/lib/actions/scorekeeper';

function TeamPanel({
  team,
  teamType,
  score,
  goaliePulled,
  shotMode,
  saves,
  disabled,
  onGoal,
  onPenalty,
  onShot,
  onQuickSave,
  onGoaliePull,
}: {
  team: TeamData;
  teamType: 'home' | 'away';
  score: number;
  goaliePulled: boolean;
  shotMode: 'simple' | 'advanced';
  saves: number;
  disabled: boolean;
  onGoal: () => void;
  onPenalty: () => void;
  onShot?: () => void;
  onQuickSave: (goalieId: string) => void;
  onGoaliePull: () => void;
}) {
  const color = team.primaryColor || 'var(--league-primary, #d4af37)';
  const goalies = team.roster.filter(p => isGoaliePosition(p.position));

  return (
    <div
      className="flex-1 flex flex-col items-center gap-2 p-3 rounded-2xl border transition-all"
      style={{
        backgroundColor: `${color}08`,
        borderColor: `${color}30`,
      }}
    >
      {/* Team Logo + Name */}
      <div className="flex items-center gap-2">
        {team.logoUrl ? (
          <Image
            src={team.logoUrl}
            alt={team.name}
            width={36}
            height={36}
            className="w-9 h-9 rounded-lg object-contain"
          />
        ) : (
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold"
            style={{
              backgroundColor: `${color}20`,
              color: color,
            }}
          >
            {(team.shortName || team.name).slice(0, 3).toUpperCase()}
          </div>
        )}
        <div className="text-left min-w-0">
          <div className="text-[10px] font-medium text-[var(--color-text-secondary)] uppercase">
            {teamType === 'home' ? 'Home' : 'Away'}
          </div>
          <div className="text-xs font-bold text-[var(--color-text-primary)] truncate max-w-[80px]">
            {team.shortName || team.name}
          </div>
        </div>
      </div>

      {/* Score — big and prominent */}
      <div
        className="text-5xl font-bold tabular-nums leading-none"
        style={{ color }}
      >
        {score}
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-1.5 w-full mt-1">
        <button
          onClick={onGoal}
          disabled={disabled}
          className="w-full py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-30 bg-green-500/15 text-green-400 hover:bg-green-500/25 border border-green-500/20"
        >
          + Goal
        </button>
        <button
          onClick={onPenalty}
          disabled={disabled}
          className="w-full py-2.5 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-30 bg-yellow-500/15 text-yellow-400 hover:bg-yellow-500/25 border border-yellow-500/20"
        >
          + Penalty
        </button>

        {/* Save Button — clear goalie-labeled button */}
        <SaveButton
          goalies={goalies}
          teamColor={team.primaryColor}
          pulled={goaliePulled}
          shotMode={shotMode}
          saves={saves}
          disabled={disabled}
          onQuickSave={onQuickSave}
          onAdvancedShot={onShot}
        />
      </div>

      {/* Goalie Pull */}
      <button
        onClick={onGoaliePull}
        disabled={disabled}
        className={`text-[10px] font-medium px-2 py-1 rounded transition-colors ${
          goaliePulled
            ? 'bg-purple-500/20 text-purple-400'
            : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]'
        }`}
      >
        {goaliePulled ? 'Return Goalie' : 'Pull Goalie'}
      </button>
    </div>
  );
}
