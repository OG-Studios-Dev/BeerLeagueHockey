import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAccessibilityPreferences } from '../../context/AccessibilityPreferencesContext';
import { filterSubCandidatesByReplacementRole, getSubPositionRole, matchesSubCandidateSearch } from '../../lib/captain/subRoleFilter';
import { getCaptainSubInvitationContext, manageCaptainSubInvitation, createCaptainSubInvitationRequestId, type CaptainSubInvitationCommand, type CaptainSubInvitationScope } from '../../lib/supabase/subInvitations';
import colors from '../../theme/colors';
type Context = NonNullable<Awaited<ReturnType<typeof getCaptainSubInvitationContext>>['data']>;
type Receipt = NonNullable<Awaited<ReturnType<typeof manageCaptainSubInvitation>>['data']>;
type Attempt = { command: CaptainSubInvitationCommand; pending: boolean; receipt?: Receipt };
type Props = { scope: CaptainSubInvitationScope; actorId: string | null; visible: boolean; gameDateLabel?: string; onClose(): void };
export default function FindSpareModal(props: Props) {
  const [journal] = React.useState(() => new Map<string, Attempt>());
  const focused = useIsFocused();
  const owner = `${props.actorId}:${props.scope.leagueId}:${props.scope.teamId}:${props.scope.gameId}`;
  const preferences = useAccessibilityPreferences();
  const open = props.visible && focused && Boolean(props.actorId);
  return <Modal visible={open} transparent animationType={preferences.reduceMotion ? 'none' : 'fade'} onRequestClose={props.onClose}>
    {open && <Session key={owner} {...props} journal={journal} owner={owner} />}
  </Modal>;
}
function Session({ scope, gameDateLabel, onClose, journal, owner }: Props & { journal: Map<string, Attempt>; owner: string }) {
  const { gameId, teamId, leagueId } = scope;
  const { reduceTransparency } = useAccessibilityPreferences();
  const alive = React.useRef(false);
  const loadGeneration = React.useRef(0);
  const viewGeneration = React.useRef(0);
  const renderedGeneration = viewGeneration.current;
  const [attempt, setAttempt] = React.useState<Attempt | undefined>(() => journal.get(owner));
  const [receipt, setReceipt] = React.useState<Receipt | null>(null);
  const [receipts, setReceipts] = React.useState<Record<string, Receipt>>({});
  const [data, setData] = React.useState<Context | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [replacementId, setReplacementId] = React.useState<string | null>(null);
  const [replacementOpen, setReplacementOpen] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [search, setSearch] = React.useState('');
  const [manualName, setManualName] = React.useState('');
  const [manualPosition, setManualPosition] = React.useState<'Forward' | 'Defense' | 'Goalie' | null>(null);
  const [positionOpen, setPositionOpen] = React.useState(false);
  const [manualJersey, setManualJersey] = React.useState('');
  const [saveToSpares, setSaveToSpares] = React.useState(false);
  const [mode, setMode] = React.useState<'spare' | 'recent' | 'manual'>('spare');
  const [recent, setRecent] = React.useState<Context['recent_players']>([]);
  const [recentLoading, setRecentLoading] = React.useState(false);
  const recentGeneration = React.useRef(0);
  React.useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; loadGeneration.current += 1; }; }, []);
  const load = React.useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true); setError(null);
    try {
      const result = await getCaptainSubInvitationContext({ gameId, teamId, leagueId });
      if (!alive.current || generation !== loadGeneration.current) return;
      if (result.error || !result.data) { setError(result.error ?? 'Unable to load spares.'); return; }
      setData(result.data); setReplacementId(result.data.replacements[0]?.player_id ?? null);
    } catch { if (alive.current && generation === loadGeneration.current) setError('Unable to load spares. Please try again.'); }
    finally { if (alive.current && generation === loadGeneration.current) setLoading(false); }
  }, [gameId, teamId, leagueId]);
  React.useEffect(() => { void load(); }, [load]);
  const close = () => { if (!alive.current) return; alive.current = false; loadGeneration.current += 1; onClose(); };
  const edit = (action: () => void) => {
    if (!alive.current || renderedGeneration !== viewGeneration.current || journal.get(owner) && !journal.get(owner)?.receipt) return;
    viewGeneration.current += 1; action();
  };
  const replacement = data?.replacements.find(p => p.player_id === replacementId);
  const role = getSubPositionRole(replacement?.position);
  const invitations = [...(data?.invitations ?? []).filter(i => !receipts[i.player_id]), ...Object.values(receipts).map(r => r.invitation)];
  const candidates = filterSubCandidatesByReplacementRole<Context['candidates'][number] | Context['recent_players'][number]>(mode === 'recent' ? recent : data?.candidates ?? [], replacement?.position).filter(p => matchesSubCandidateSearch(p, search));
  const chooseReplacement = (id: string | null) => edit(() => {
    const next = data?.replacements.find(p => p.player_id === id);
    if (id && !next) return;
    if (getSubPositionRole(next?.position) !== role) { setSearch(''); setRecent([]); setManualPosition(null); recentGeneration.current += 1; setRecentLoading(false); if (mode === 'recent') void loadRecent(id); }
    setReplacementId(id); setReplacementOpen(false); if (!id) setConfirmed(false);
  });
  async function loadRecent(id = replacementId) {
    const generation = ++recentGeneration.current; setRecentLoading(true); setError(null);
    try {
      const result = await getCaptainSubInvitationContext(scope, id, true);
      if (!alive.current || generation !== recentGeneration.current) return;
      if (result.error || !result.data) setError(result.error ?? 'Unable to load recent players.');
      else setRecent(result.data.recent_players);
    } catch { if (alive.current && generation === recentGeneration.current) setError('Unable to load recent players.'); }
    finally { if (alive.current && generation === recentGeneration.current) setRecentLoading(false); }
  }
  const changeMode = (next: 'spare' | 'recent' | 'manual') => edit(() => {
    setMode(next); setSearch(''); setRecent([]); setError(null); recentGeneration.current += 1; setRecentLoading(false);
    if (next === 'recent') void loadRecent();
  });
  async function execute(command: CaptainSubInvitationCommand) {
    if (!alive.current || journal.get(owner)?.pending) return;
    const operation: Attempt = { command, pending: true }; journal.set(owner, operation); setAttempt(operation); setError(null);
    viewGeneration.current += 1;
    try {
      const result = await manageCaptainSubInvitation(command);
      operation.pending = false;
      if (result.error || !result.data) {
        if (result.rejected && journal.get(owner) === operation) {
          journal.delete(owner);
          if (alive.current) { setAttempt(undefined); setError(result.error); }
          return;
        }
        if (alive.current) { setAttempt({ ...operation }); setError(result.error ?? 'Result unknown. Retry the same request.'); } return;
      }
      operation.receipt = result.data;
      if (!alive.current) return;
      if (command.kind === 'manual') { setManualName(''); setManualPosition(null); setManualJersey(''); }
      setReceipt(result.data); setReceipts(current => ({ ...current, [result.data!.invitation.player_id]: result.data! })); setAttempt({ ...operation });
      const generation = ++loadGeneration.current;
      try {
        const refreshed = await getCaptainSubInvitationContext(scope, null, false);
        if (!alive.current || generation !== loadGeneration.current) return;
        if (refreshed.error || !refreshed.data) setError('Saved. Unable to refresh spares. Retry to refresh, not resend.');
        else setData(refreshed.data);
      } catch { if (alive.current) setError('Saved. Unable to refresh spares. Retry to refresh, not resend.'); }
    } catch { operation.pending = false; if (alive.current) { setAttempt({ ...operation }); setError('Result unknown. Retry the same request.'); } }
  }
  function submit(playerId: string) {
    if (!alive.current || renderedGeneration !== viewGeneration.current || !data || journal.get(owner) && !journal.get(owner)?.receipt) return;
    if (!candidates.some(p => p.player_id === playerId)) return;
    const existing = invitations.find(i => i.player_id === playerId); if (existing?.status === 'accepted') return;
    void execute({ gameId: scope.gameId, teamId: scope.teamId, leagueId: scope.leagueId, requestId: createCaptainSubInvitationRequestId(), kind: mode === 'recent' ? 'recent' : 'spare', playerId, replacedPlayerId: replacementId, message: message || null, confirmed: Boolean(existing) || Boolean(replacement && confirmed), saveToTeamSpares: false });
  }
  const validManual = manualName.trim().length >= 2 && (!manualJersey || /^\d{1,3}$/.test(manualJersey) && Number(manualJersey) >= 1 && Number(manualJersey) <= 99);
  const submitManual = () => {
    if (!alive.current || renderedGeneration !== viewGeneration.current || !validManual || journal.get(owner) && !journal.get(owner)?.receipt) return;
    if (manualPosition && role && getSubPositionRole(manualPosition) !== role) return;
    void execute({ gameId: scope.gameId, teamId: scope.teamId, leagueId: scope.leagueId, requestId: createCaptainSubInvitationRequestId(), kind: 'manual', manualName: manualName.trim(), manualPosition, manualJersey: manualJersey ? Number(manualJersey) : null, replacedPlayerId: replacementId, message: message || null, confirmed: true, saveToTeamSpares: saveToSpares });
  };
  const retry = () => {
    if (!alive.current || renderedGeneration !== viewGeneration.current || journal.get(owner)?.pending) return;
    const current = journal.get(owner);
    if (current && !current.receipt) void execute(current.command); else if (mode === 'recent') void loadRecent(); else void load();
  };
  return <SafeAreaView style={[styles.overlay, reduceTransparency && styles.opaqueOverlay]} onAccessibilityEscape={close}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.keyboard}>
      <View testID="find-spare-sheet" accessibilityViewIsModal style={styles.sheet}>
        <View style={styles.header}><View style={styles.heading}><View style={styles.inline}><Ionicons name="person-add-outline" size={20} color={colors.primary} /><Text accessibilityRole="header" style={styles.title}>Find Spare</Text></View>{gameDateLabel && <Text style={styles.secondary}>{gameDateLabel}</Text>}</View>
          <Pressable testID="find-spare-close" accessibilityRole="button" accessibilityLabel="Close Find Spare" onPress={close} style={styles.close}><Ionicons name="close" size={24} color={colors.textSecondary} /></Pressable></View>
        <ScrollView testID="find-spare-body" style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {loading && <ActivityIndicator testID="find-spare-loading" color={colors.primary} />}
          {error && <View testID="find-spare-error"><Text accessibilityRole="alert" style={styles.error}>{error}</Text><Pressable testID="find-spare-retry" accessibilityRole="button" onPress={retry} style={styles.button}><Text style={styles.link}>Retry</Text></Pressable></View>}
          {!error && attempt && !attempt.receipt && <View><Text style={styles.secondary}>This request has not been verified. Retry will reuse the same request, not create a duplicate.</Text><Pressable testID="find-spare-retry" accessibilityRole="button" onPress={retry} style={styles.button}><Text style={styles.link}>Retry</Text></Pressable></View>}
          {data && <>
            <Text style={styles.label}>REPLACING</Text>
            <Pressable testID="find-spare-replacement" accessibilityRole="button" accessibilityLabel={`Replacing ${replacement?.full_name ?? 'No specific player'}`} accessibilityState={{ expanded: replacementOpen }} onPress={() => edit(() => setReplacementOpen(v => !v))} style={styles.input}><Text style={styles.text}>{replacement ? `${replacement.jersey_number == null ? '' : `#${replacement.jersey_number} `}${replacement.full_name ?? 'Unknown player'}${replacement.position ? ` (${replacement.position})` : ''}` : 'No specific player'}</Text></Pressable>
            {replacementOpen && <View style={styles.panel}><Pressable testID="find-spare-replace-none" onPress={() => chooseReplacement(null)} style={styles.button}><Text style={styles.text}>No specific player</Text></Pressable>{data.replacements.map(p => <Pressable key={p.player_id} testID={`find-spare-replace-${p.player_id}`} accessibilityRole="button" onPress={() => chooseReplacement(p.player_id)} style={styles.button}><Text style={styles.text}>{p.full_name} {p.position ? `(${p.position})` : ''}</Text></Pressable>)}</View>}
            {!data.replacements.length && <Text style={styles.secondary}>Tip: Mark a player Out first to choose who this sub is replacing.</Text>}
            {replacement && <Pressable testID="find-spare-confirmed" accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }} onPress={() => edit(() => setConfirmed(v => !v))} style={styles.confirmPanel}><Text style={styles.text}>{confirmed ? '☑' : '☐'} Sub already confirmed in</Text><Text style={styles.secondary}>Use this when you already called or texted the sub. They will show as In immediately.</Text></Pressable>}
            <TextInput testID="find-spare-message" accessibilityLabel="Optional message to the player" multiline value={message} onChangeText={v => edit(() => setMessage(v))} placeholder="Optional message to the player..." placeholderTextColor={colors.textSecondary} style={[styles.input, styles.message]} />
            <View style={styles.modes}><Pressable testID="find-spare-mode-manual" accessibilityRole="button" accessibilityState={{ selected: mode === 'manual' }} onPress={() => changeMode('manual')} style={[styles.modeButton, mode === 'manual' && styles.selected]}><Text style={styles.text}>Add New Sub</Text></Pressable><Pressable testID="find-spare-mode-recent" accessibilityRole="button" accessibilityState={{ selected: mode === 'recent' }} onPress={() => changeMode('recent')} style={[styles.modeButton, mode === 'recent' && styles.selected]}><Text style={styles.text}>Select Recent Player</Text></Pressable></View>
            {mode !== 'spare' && <Pressable testID="find-spare-mode-available" accessibilityRole="button" onPress={() => changeMode('spare')} style={styles.back}><Text style={styles.link}>Back to available spares</Text></Pressable>}
            {recentLoading && <ActivityIndicator color={colors.primary} />}
            {mode === 'manual' ? <View testID="find-spare-manual-form" style={styles.panel}>
              <View style={styles.inline}><Text style={styles.text}>Add new sub</Text><Text style={[styles.badge, styles.success]}>ONE GAME</Text></View>
              <TextInput testID="find-spare-manual-name" accessibilityLabel="Player name" value={manualName} onChangeText={v => edit(() => setManualName(v))} placeholder="Player name" placeholderTextColor={colors.textSecondary} style={styles.input} />
              <View style={styles.inline}><View style={styles.position}><Pressable testID="find-spare-manual-position" accessibilityRole="button" accessibilityLabel="Position, optional" accessibilityState={{ expanded: positionOpen }} onPress={() => edit(() => setPositionOpen(v => !v))} style={styles.input}><Text style={styles.text}>{manualPosition ?? 'Position'} ▾</Text></Pressable>{positionOpen && <View style={styles.inline}>{(['Forward', 'Defense', 'Goalie'] as const).filter(p => !role || getSubPositionRole(p) === role).map(p => <Pressable key={p} testID={`find-spare-position-${p}`} accessibilityRole="radio" accessibilityState={{ selected: manualPosition === p }} onPress={() => edit(() => { setManualPosition(v => v === p ? null : p); setPositionOpen(false); })} style={[styles.button, manualPosition === p && styles.selected]}><Text style={styles.text}>{p}</Text></Pressable>)}</View>}</View>
              <TextInput testID="find-spare-manual-jersey" accessibilityLabel="Jersey number, optional, 1 to 99" keyboardType="number-pad" value={manualJersey} onChangeText={v => edit(() => setManualJersey(v))} placeholder="#" placeholderTextColor={colors.textSecondary} style={[styles.input, styles.jersey]} /></View>
              <Pressable testID="find-spare-save-to-spares" accessibilityRole="checkbox" accessibilityState={{ checked: saveToSpares }} onPress={() => edit(() => setSaveToSpares(v => !v))} style={styles.check}><Text style={styles.secondary}>{saveToSpares ? '☑' : '☐'} Save to team spares</Text></Pressable>
              <Pressable testID="find-spare-manual-submit" accessibilityRole="button" disabled={!validManual || Boolean(attempt && !attempt.receipt)} onPress={submitManual} style={styles.action}><Text style={styles.success}>{attempt?.pending ? 'Saving…' : 'Add + Mark In'}</Text></Pressable>
              {receipt && attempt?.command.kind === 'manual' && <Text accessibilityLiveRegion="polite" style={styles.success}>{receipt.player.full_name ?? manualName} — Confirmed In</Text>}
            </View> : <>
            <TextInput testID="find-spare-search" accessibilityLabel="Search by name or email" value={search} onChangeText={v => edit(() => setSearch(v))} placeholder={mode === 'recent' ? 'Search recent players...' : 'Search by name or email...'} placeholderTextColor={colors.textSecondary} style={styles.input} />
            {!candidates.length && <Text style={styles.secondary}>No matching spares.</Text>}
            {candidates.map(p => { const invitation = invitations.find(i => i.player_id === p.player_id); const accepted = invitation?.status === 'accepted'; return <View key={p.player_id} testID={`find-spare-row-${p.player_id}`} style={styles.row}><View style={styles.person}><View style={styles.inline}><Text style={styles.text}>{p.full_name ?? 'Unknown player'}</Text><Text style={styles.badge}>{p.source.toUpperCase()}</Text></View><Text style={styles.secondary}>{[p.position, p.email, 'last_played_at' in p && p.last_played_at ? `Last played ${new Date(p.last_played_at).toLocaleDateString()}` : null].filter(Boolean).join(' · ') || 'Active spare'}</Text></View><Pressable testID={`find-spare-action-${p.player_id}`} accessibilityRole="button" disabled={accepted || Boolean(attempt && !attempt.receipt)} onPress={() => submit(p.player_id)} style={styles.action}><Text style={accepted ? styles.success : styles.link}>{accepted ? 'Confirmed In' : attempt?.pending && attempt.command.playerId === p.player_id ? 'Saving…' : invitation ? 'Mark In' : replacement && confirmed ? 'Invite + Mark In' : 'Invite'}</Text></Pressable></View>; })}</> }
          </>}
        </ScrollView>
        <View style={styles.footer}><Pressable testID="find-spare-done" accessibilityRole="button" onPress={close} style={styles.button}><Text style={styles.text}>Done</Text></Pressable></View>
      </View>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', padding: 16, backgroundColor: '#000000B8' }, opaqueOverlay: { backgroundColor: '#050B14' }, keyboard: { width: '100%', maxWidth: 520, maxHeight: '94%', alignSelf: 'center' },
  sheet: { flexShrink: 1, width: '100%', borderWidth: 1, borderColor: colors.glassStroke, borderRadius: 14, backgroundColor: colors.bgModal, overflow: 'hidden' }, header: { padding: 16, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: 1, borderBottomColor: colors.glassStroke }, heading: { flex: 1, gap: 6 }, title: { color: colors.textPrimary, fontSize: 18, fontWeight: '700' }, close: { width: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  body: { flexShrink: 1 }, bodyContent: { padding: 16, gap: 8 }, footer: { borderTopWidth: 1, borderTopColor: colors.glassStroke, padding: 8 }, button: { minHeight: 44, padding: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 8 },
  position: { flex: 1, minWidth: 140 }, jersey: { width: 72 }, check: { minHeight: 44, justifyContent: 'center' },
  modes: { flexDirection: 'row', gap: 8 }, modeButton: { flex: 1, minHeight: 56, padding: 10, borderWidth: 1, borderColor: colors.glassStroke, borderRadius: 8, justifyContent: 'center', alignItems: 'center' }, selected: { borderColor: colors.primary, backgroundColor: colors.bgInteractive }, back: { minHeight: 44, justifyContent: 'center' },
  action: { minHeight: 44, minWidth: 64, padding: 8, justifyContent: 'center', backgroundColor: colors.bgInteractive, borderRadius: 8 }, success: { color: colors.accentGreen, fontSize: 13 },
  text: { color: colors.textPrimary, fontSize: 14 }, secondary: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 }, label: { color: colors.textSecondary, fontSize: 12, letterSpacing: 1.5, fontWeight: '700' }, input: { minHeight: 44, borderWidth: 1, borderColor: colors.glassStroke, borderRadius: 8, padding: 12, color: colors.textPrimary, fontSize: 14, justifyContent: 'center' }, message: { minHeight: 60, textAlignVertical: 'top', marginBottom: 8 },
  panel: { padding: 12, borderWidth: 1, borderColor: colors.glassStroke, borderRadius: 8, gap: 8 }, confirmPanel: { padding: 12, gap: 4, backgroundColor: '#0A2835', borderRadius: 8, minHeight: 44 }, inline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingVertical: 12 }, person: { flex: 1, minWidth: 140 }, badge: { fontSize: 10, letterSpacing: 1, color: colors.primary, backgroundColor: colors.bgInteractive, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }, error: { color: colors.accentRed, fontSize: 14 }, link: { color: colors.primary, fontSize: 13 },
});
