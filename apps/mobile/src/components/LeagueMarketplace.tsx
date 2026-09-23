import { Ionicons } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import React from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FocusCard, FocusFlatList, FocusScrollView } from './CardFocus';
import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../context/LeagueContext';
import { getLeagueMarketplace, type LeagueMatch } from '../lib/leagueMarketplace';
import { supabase } from '../lib/supabase/client';
import colors from '../theme/colors';
import { getContrastTextColor } from '../theme/contrast';
import MembershipDiagnosticsCard from './MembershipDiagnosticsCard';
import TeamLogo from './TeamLogo';

type SortMode = 'nearest' | 'fit';
type MembershipActionState = 'available' | 'loading' | 'unavailable' | 'guest';

// --- Skeleton Card ---
function SkeletonCard() {
  return (
    <View style={[styles.card, { borderLeftColor: colors.borderCard }]}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <View style={styles.skeletonCircle} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={[styles.skeletonBar, { width: '60%' }]} />
          <View style={[styles.skeletonBar, { width: '40%' }]} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        <View style={[styles.skeletonPill, { width: 90 }]} />
        <View style={[styles.skeletonPill, { width: 110 }]} />
      </View>
    </View>
  );
}

// --- Fit Badge ---
function FitBadge({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color + '55' }]}>
      <View style={[styles.badgeDot, { backgroundColor: color }]} />
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

// --- League Card ---
function LeagueCard({
  item,
  isMember,
  membershipActionState,
  isCompact,
  onViewPress,
  onJoinPress,
  onSelectPress,
}: {
  item: LeagueMatch;
  isMember: boolean;
  membershipActionState: MembershipActionState;
  isCompact: boolean;
  onViewPress: (item: LeagueMatch) => void;
  onJoinPress: (item: LeagueMatch) => void;
  onSelectPress: (item: LeagueMatch) => void;
}) {
  const accentColor = item.primary_color ?? colors.primary;

  const subtitle = [
    item.city,
    item.distanceKm !== null ? `${item.distanceKm} km away` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      style={[styles.card, { borderLeftColor: accentColor }]}
      onPress={() => isMember ? onSelectPress(item) : onViewPress(item)}
    >
      {/* Top row: logo + name/city */}
      <View style={[styles.cardHeader, isCompact && styles.cardHeaderCompact]}>
        <TeamLogo
          logoUrl={item.logo_url}
          teamName={item.short_name ?? item.name}
          primaryColor={accentColor}
          size={48}
        />
        <View style={styles.cardHeaderCopy}>
          <Text style={styles.leagueName} numberOfLines={1}>{item.name}</Text>
          {subtitle ? (
            <Text style={styles.leagueSubtitle} numberOfLines={1}>{subtitle}</Text>
          ) : null}
        </View>
        {isMember && (
          <View style={[styles.joinedBadge]}>
            <Ionicons name="checkmark-circle" size={14} color={colors.accentGreen} />
            <Text style={styles.joinedText}>Joined</Text>
          </View>
        )}
      </View>

      {/* Badges row */}
      <View style={styles.badgesRow}>
        <FitBadge label={item.fitLabel} color={item.fitColor} />
        {item.leagueRatingRange !== null && (
          <FitBadge
            label={`Typical: ${item.leagueRatingRange}`}
            color={colors.textSecondary}
          />
        )}
      </View>

      {/* Action buttons */}
      {isMember ? (
        <TouchableOpacity
          style={[styles.joinBtn, { borderColor: accentColor, backgroundColor: accentColor + '22' }]}
          onPress={() => onSelectPress(item)}
          activeOpacity={0.75}
        >
          <Text style={[styles.joinBtnText, { color: accentColor }]}>Enter League →</Text>
        </TouchableOpacity>
      ) : membershipActionState === 'available' ? (
        <View style={[styles.actionRow, isCompact && styles.actionRowCompact]}>
          <TouchableOpacity
            style={[styles.actionBtnOutline, { borderColor: accentColor, flex: 1 }]}
            onPress={() => onViewPress(item)}
            activeOpacity={0.75}
          >
            <Text style={[styles.actionBtnOutlineText, { color: accentColor }]}>View League</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtnGhost, { flex: 1 }]}
            onPress={() => onJoinPress(item)}
            activeOpacity={0.75}
          >
            <Text style={styles.actionBtnGhostText}>Request to Join</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.actionRow, isCompact && styles.actionRowCompact]}>
          <TouchableOpacity
            style={[styles.actionBtnOutline, { borderColor: accentColor, flex: 1 }]}
            onPress={() => onViewPress(item)}
            activeOpacity={0.75}
          >
            <Text style={[styles.actionBtnOutlineText, { color: accentColor }]}>View League</Text>
          </TouchableOpacity>
          {membershipActionState === 'guest' ? (
            <TouchableOpacity
              accessibilityLabel="Sign in to request league membership"
              style={[styles.actionBtnGhost, { flex: 1 }]}
              onPress={() => onJoinPress(item)}
              activeOpacity={0.75}
            >
              <Text style={styles.actionBtnGhostText}>Sign In to Join</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.actionBtnGhost, styles.disabledMembershipAction, { flex: 1 }]}>
              <Text style={styles.actionBtnGhostText}>
                {membershipActionState === 'loading' ? 'Checking membership…' : 'Membership unavailable'}
              </Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

type LeagueMarketplaceProps = {
  navigation?: any;
  title?: string;
  subtitle?: string;
  showJoinedLeagues?: boolean;
  includeTopInset?: boolean;
};

// --- Main component ---
export default function LeagueMarketplace({
  navigation,
  subtitle = 'Leagues near you, ranked by fit',
  showJoinedLeagues = false,
  includeTopInset = true,
}: LeagueMarketplaceProps) {
  const {
    availableLeagues,
    setActiveLeague,
    membershipStatus,
    membershipDiagnostics,
    retryMemberships,
  } = useLeague();
  const { session, isGuest, exitGuest } = useAuth();
  const { reduceMotion, reduceTransparency } = useAccessibilityPreferences();
  const { width, height } = useWindowDimensions();
  const isCompact = width < 390;

  const [leagues, setLeagues] = React.useState<LeagueMatch[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [locationGranted, setLocationGranted] = React.useState(false);
  const [locationLabel] = React.useState<string | null>(null);
  const [sortMode, setSortMode] = React.useState<SortMode>('nearest');
  const [search, setSearch] = React.useState('');
  const [userRating, setUserRating] = React.useState<string | null>(null);
  const [selectedLeague, setSelectedLeague] = React.useState<LeagueMatch | null>(null);

  // Load marketplace
  React.useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      let userId: string | null = null;
      try {
        const { data: { user }, error } = await supabase.auth.getUser();
        if (!error) userId = user?.id ?? null;
      } catch {}

      let result: Awaited<ReturnType<typeof getLeagueMarketplace>>;
      try {
        result = await getLeagueMarketplace(userId);
      } catch {
        result = { leagues: [], userRating: null, userTier: null };
      }
      if (!active) return;
      setLeagues(result.leagues);
      setUserRating(result.userRating);

      const results = result.leagues;

      const hasDistance = results.some((r) => r.distanceKm !== null);
      setLocationGranted(hasDistance);
      setSortMode(hasDistance ? 'nearest' : 'fit');

      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const memberIds = React.useMemo(
    () => new Set(availableLeagues.map((l) => l.id)),
    [availableLeagues],
  );

  const membershipActionState: MembershipActionState = isGuest
    ? 'guest'
    : !session || membershipStatus === 'loading'
      ? 'loading'
      : membershipStatus === 'ready' || membershipStatus === 'empty'
        ? 'available'
        : 'unavailable';

  const sorted = React.useMemo(() => {
    const list = [...leagues];
    if (sortMode === 'fit') {
      const fitOrder: Record<string, number> = {
        perfect: 0,
        competitive: 1,
        elite: 2,
        challenge: 3,
        beginner: 4,
      };
      list.sort(
        (a, b) =>
          (fitOrder[a.fitScore ?? ''] ?? 5) - (fitOrder[b.fitScore ?? ''] ?? 5),
      );
    }
    return list;
  }, [leagues, sortMode]);

  const filtered = React.useMemo(() => {
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.city ?? '').toLowerCase().includes(q),
    );
  }, [sorted, search]);

  const handleSelectLeague = (item: LeagueMatch) => {
    const found = availableLeagues.find((l) => l.id === item.id);
    if (found) {
      void setActiveLeague(found);
      navigation?.navigate('Schedule');
    }
  };

  const handleViewLeague = (item: LeagueMatch) => {
    setSelectedLeague(item);
  };

  const handleJoinPress = (item: LeagueMatch) => {
    if (isGuest) {
      exitGuest();
      return;
    }
    Alert.alert(
      'Request to Join',
      `Contact your league admin to join ${item.name}. Visit beerleaguehockey.ca to learn more.`,
    );
  };

  const handleEnableLocation = () => {
    Linking.openSettings();
  };

  const openLeagueSite = (item: LeagueMatch) => {
    Linking.openURL(`https://${item.slug}.beerleaguehockey.ca`).catch(() => {});
  };

  const joinedLeagueStrip = showJoinedLeagues && availableLeagues.length > 0 ? (
    <FocusCard focusId="marketplace:joined" style={styles.joinedLeaguesSection}>
      <Text style={styles.sectionEyebrow}>Your leagues</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.joinedLeaguesScroller}>
        {availableLeagues.map((league) => (
          <Pressable
            key={league.id}
            style={styles.joinedLeaguePill}
            onPress={() => {
              void setActiveLeague(league);
              navigation?.navigate('Schedule');
            }}
          >
            <View style={[styles.joinedLeagueDot, { backgroundColor: league.theme.primaryColor }]} />
            <Text style={styles.joinedLeagueText} numberOfLines={1}>
              {league.name}
            </Text>
            <Ionicons name="arrow-forward" size={13} color={colors.textSecondary} />
          </Pressable>
        ))}
      </ScrollView>
    </FocusCard>
  ) : null;

  const membershipFailure = !isGuest && session && (membershipStatus === 'error' || membershipStatus === 'incomplete');
  const listHeader = (
    <>
      <View style={styles.marketplaceContext}>
        <Text accessibilityRole="header" style={styles.subtitle}>{subtitle}</Text>
        {userRating !== null ? (
          <View style={styles.userRatingRow}>
            <Text style={styles.userRatingLabel}>Your Rating:</Text>
            <View style={[styles.userRatingChip, { backgroundColor: colors.primary + '33', borderColor: colors.primary }]}>
              <Text style={[styles.userRatingText, { color: colors.primary }]}>{userRating}</Text>
            </View>
          </View>
        ) : null}
      </View>
      {membershipFailure ? (
        <FocusCard focusId="marketplace:membership">
          <View style={styles.membershipNotice} accessibilityRole="alert">
          <Text style={styles.membershipNoticeTitle}>
            {membershipStatus === 'error' ? "Couldn't load leagues" : 'Membership unavailable'}
          </Text>
          <Text style={styles.membershipNoticeBody}>
            We could not confirm all of your league memberships. Existing league access is kept when available.
          </Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Retry loading league memberships"
            style={styles.membershipRetry}
            onPress={retryMemberships}
          >
            <Text style={styles.membershipRetryText}>Retry</Text>
          </TouchableOpacity>
          <MembershipDiagnosticsCard
            diagnostics={membershipDiagnostics}
            status={membershipStatus}
            onRetry={retryMemberships}
            initiallyExpanded
          />
          </View>
        </FocusCard>
      ) : null}
      {joinedLeagueStrip}
    </>
  );

  return (
    <SafeAreaView style={styles.container} edges={includeTopInset ? ['top', 'left', 'right'] : ['left', 'right']} onAccessibilityEscape={() => navigation?.goBack?.()}>
      <View style={[styles.sortRow, isCompact && styles.sortRowCompact]}>
        <TouchableOpacity
          style={[styles.locationPill, isCompact && styles.locationPillCompact]}
          onPress={locationGranted ? undefined : handleEnableLocation}
          activeOpacity={locationGranted ? 1 : 0.7}
        >
          <Text style={styles.locationPillText}>
            {locationGranted
              ? `📍 ${locationLabel ?? 'Nearby'}`
              : '📍 Enable Location'}
          </Text>
        </TouchableOpacity>
        {(['nearest', 'fit'] as SortMode[]).map((mode) => (
          <TouchableOpacity
            key={mode}
            style={[styles.sortPill, sortMode === mode && styles.sortPillActive]}
            onPress={() => setSortMode(mode)}
            activeOpacity={0.75}
          >
            <Text style={[styles.sortPillText, sortMode === mode && styles.sortPillTextActive]}>
              {mode === 'nearest' ? 'Nearest' : 'Best Fit'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={colors.textSecondary} style={{ marginRight: 8 }} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search leagues or cities..."
          placeholderTextColor={colors.textSecondary}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* List */}
      {loading ? (
        <View style={{ paddingHorizontal: 16, gap: 10, marginTop: 4 }}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : (
        <FocusFlatList
          focusEnabled={selectedLeague == null}
          focusScopeKey={`marketplace:list:${membershipStatus}`}
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={listHeader}
          renderItem={({ item }) => (
            <LeagueCard
              item={item}
              isMember={memberIds.has(item.id)}
              membershipActionState={membershipActionState}
              isCompact={isCompact}
              onViewPress={handleViewLeague}
              onJoinPress={handleJoinPress}
              onSelectPress={handleSelectLeague}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🏒</Text>
              <Text style={styles.emptyText}>No leagues found</Text>
              {search ? (
                <Text style={styles.emptySubtext}>Try a different search term</Text>
              ) : null}
            </View>
          }
          showsVerticalScrollIndicator={false}
        />
      )}

      <Modal
        visible={selectedLeague != null}
        transparent
        animationType={reduceMotion ? 'none' : 'fade'}
        onRequestClose={() => setSelectedLeague(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessible={false}
            style={[styles.modalOverlay, reduceTransparency && styles.modalOverlayOpaque]}
            onPress={() => setSelectedLeague(null)}
          />
          <SafeAreaView pointerEvents="box-none" edges={['top', 'bottom']} style={styles.modalSafeArea}>
            {selectedLeague ? (
              <View
                accessibilityViewIsModal
                accessibilityLabel={`${selectedLeague.name} league details`}
                style={[styles.modalCard, { maxHeight: Math.max(280, height - 32) }]}
              >
                <FocusScrollView
                  focusEnabled={selectedLeague != null}
                  focusScopeKey={`marketplace-modal:${selectedLeague.id}`}
                  includeBottomTabInset={false}
                  bounces={false}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.modalContent}
                >
                  <View style={styles.modalHeader}>
                    <TeamLogo
                      logoUrl={selectedLeague.logo_url}
                      teamName={selectedLeague.short_name ?? selectedLeague.name}
                      primaryColor={selectedLeague.primary_color ?? colors.primary}
                      size={56}
                    />
                    <View style={styles.modalHeaderCopy}>
                      <Text style={styles.modalTitle}>{selectedLeague.name}</Text>
                      <Text style={styles.modalSubtitle}>
                        {[
                          selectedLeague.city,
                          selectedLeague.distanceKm != null ? `${selectedLeague.distanceKm} km away` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Close league details"
                      hitSlop={8}
                      style={styles.modalCloseButton}
                      onPress={() => setSelectedLeague(null)}
                    >
                      <Ionicons name="close" size={22} color={colors.textPrimary} />
                    </Pressable>
                  </View>

                  <View style={styles.modalBadges}>
                    <FitBadge label={selectedLeague.fitLabel} color={selectedLeague.fitColor} />
                    {selectedLeague.leagueMedianRating ? (
                      <FitBadge label={`Median: ${selectedLeague.leagueMedianRating}`} color={colors.primary} />
                    ) : null}
                    {selectedLeague.leagueRatingRange ? (
                      <FitBadge label={`Range: ${selectedLeague.leagueRatingRange}`} color={colors.textSecondary} />
                    ) : null}
                  </View>

                  <FocusCard focusId={`marketplace:modal:${selectedLeague.id}:fit`} style={styles.modalSection}>
                    <Text style={styles.modalSectionTitle}>Why it fits</Text>
                    <Text style={styles.modalSectionBody}>
                      BLH Overview ranks leagues using your location and player-rating fit. This league is currently marked as{' '}
                      <Text style={[styles.modalSectionBody, { color: selectedLeague.fitColor }]}>
                        {selectedLeague.fitLabel.toLowerCase()}
                      </Text>
                      .
                    </Text>
                  </FocusCard>

                  {membershipFailure ? (
                    <FocusCard focusId={`marketplace:modal:${selectedLeague.id}:membership`}>
                      <View style={styles.modalMembershipNotice} accessibilityRole="alert">
                      <Text style={styles.membershipNoticeTitle}>
                        {membershipStatus === 'error' ? "Couldn't load leagues" : 'Membership unavailable'}
                      </Text>
                      <Text style={styles.membershipNoticeBody}>
                        Membership actions are paused until the league check succeeds.
                      </Text>
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel="Retry loading league memberships from league details"
                        style={styles.membershipRetry}
                        onPress={retryMemberships}
                      >
                        <Text style={styles.membershipRetryText}>Retry</Text>
                      </TouchableOpacity>
                      <MembershipDiagnosticsCard
                        diagnostics={membershipDiagnostics}
                        status={membershipStatus}
                        onRetry={retryMemberships}
                      />
                      </View>
                    </FocusCard>
                  ) : null}

                  <View style={styles.modalActions}>
                    {memberIds.has(selectedLeague.id) ? (
                      <TouchableOpacity
                        style={[
                          styles.modalPrimaryButton,
                          { backgroundColor: selectedLeague.primary_color ?? colors.primary },
                        ]}
                        onPress={() => {
                          setSelectedLeague(null);
                          handleSelectLeague(selectedLeague);
                        }}
                        activeOpacity={0.82}
                      >
                        <Text
                          style={[
                            styles.modalPrimaryButtonText,
                            { color: getContrastTextColor(selectedLeague.primary_color ?? colors.primary) },
                          ]}
                        >
                          Open League
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={[
                            styles.modalPrimaryButton,
                            { backgroundColor: selectedLeague.primary_color ?? colors.primary },
                          ]}
                          onPress={() => openLeagueSite(selectedLeague)}
                          activeOpacity={0.82}
                        >
                          <Text
                            style={[
                              styles.modalPrimaryButtonText,
                              { color: getContrastTextColor(selectedLeague.primary_color ?? colors.primary) },
                            ]}
                          >
                            Open League Site
                          </Text>
                        </TouchableOpacity>
                        {membershipActionState === 'available' ? (
                          <TouchableOpacity
                            style={styles.modalSecondaryButton}
                            onPress={() => handleJoinPress(selectedLeague)}
                            activeOpacity={0.82}
                          >
                            <Text style={styles.modalSecondaryButtonText}>Request to Join</Text>
                          </TouchableOpacity>
                        ) : membershipActionState === 'guest' ? (
                          <TouchableOpacity
                            accessibilityLabel="Sign in to request league membership"
                            style={styles.modalSecondaryButton}
                            onPress={() => handleJoinPress(selectedLeague)}
                            activeOpacity={0.82}
                          >
                            <Text style={styles.modalSecondaryButtonText}>Sign In to Join</Text>
                          </TouchableOpacity>
                        ) : (
                          <View style={[styles.modalSecondaryButton, styles.disabledMembershipAction]}>
                            <Text style={styles.modalSecondaryButtonText}>
                              {membershipActionState === 'loading' ? 'Checking membership…' : 'Membership unavailable'}
                            </Text>
                          </View>
                        )}
                      </>
                    )}
                  </View>
                </FocusScrollView>
              </View>
            ) : null}
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },

  marketplaceContext: { paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 },
  subtitle: { fontSize: 13, lineHeight: 19, color: colors.textSecondary },
  locationPill: {
    backgroundColor: colors.bgInteractive,
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  locationPillCompact: {
    alignSelf: 'flex-start',
  },
  locationPillText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },

  userRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  userRatingLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  userRatingChip: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, borderWidth: 1,
  },
  userRatingText: { fontSize: 13, fontWeight: '900' },

  sortRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  sortRowCompact: {
    flexWrap: 'wrap',
  },
  sortPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.bgInteractive,
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  sortPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  sortPillText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  sortPillTextActive: { color: colors.textOnPrimary },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderCard,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
    padding: 0,
  },

  listContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  membershipNotice: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accentRed,
    backgroundColor: colors.bgSurface,
    padding: 14,
    gap: 8,
    marginBottom: 10,
  },
  membershipNoticeTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '900' },
  membershipNoticeBody: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  membershipRetry: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.bgInteractive,
  },
  membershipRetryText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  joinedLeaguesSection: {
    gap: 8,
    paddingBottom: 10,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.textSecondary,
  },
  joinedLeaguesScroller: {
    gap: 8,
    paddingVertical: 2,
  },
  joinedLeaguePill: {
    minWidth: 156,
    maxWidth: 240,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  joinedLeagueDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  joinedLeagueText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
    color: colors.textPrimary,
  },

  card: {
    backgroundColor: colors.bgSurface,
    borderRadius: 14,
    borderLeftWidth: 4,
    padding: 14,
    gap: 10,
  },
  cardHeader: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  cardHeaderCompact: { alignItems: 'flex-start' },
  cardHeaderCopy: { flex: 1, minWidth: 0 },
  leagueName: { fontSize: 16, fontWeight: '800', color: colors.textPrimary },
  leagueSubtitle: { fontSize: 12, color: colors.textSecondary, fontWeight: '600', marginTop: 2 },

  badgesRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' },

  joinedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: colors.accentGreen + '22',
  },
  joinedText: { fontSize: 11, fontWeight: '700', color: colors.accentGreen },

  joinBtn: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 9,
    alignItems: 'center',
    marginTop: 2,
  },
  joinBtnText: { fontSize: 14, fontWeight: '800' },

  actionRow: { flexDirection: 'row', gap: 8, marginTop: 2 },
  actionRowCompact: { flexDirection: 'column' },
  actionBtnOutline: {
    borderRadius: 10,
    borderWidth: 1.5,
    paddingVertical: 9,
    alignItems: 'center',
  },
  actionBtnOutlineText: { fontSize: 13, fontWeight: '800' },
  actionBtnGhost: {
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.borderCard,
    paddingVertical: 9,
    alignItems: 'center',
  },
  actionBtnGhostText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  disabledMembershipAction: { opacity: 0.72, justifyContent: 'center', alignItems: 'center' },

  // Skeleton
  skeletonCircle: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.bgInteractive },
  skeletonBar: { height: 12, borderRadius: 6, backgroundColor: colors.bgInteractive },
  skeletonPill: { height: 24, borderRadius: 12, backgroundColor: colors.bgInteractive },

  // Empty
  emptyState: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyIcon: { fontSize: 36 },
  emptyText: { fontSize: 17, fontWeight: '800', color: colors.textPrimary },
  emptySubtext: { fontSize: 13, color: colors.textSecondary },
  modalRoot: {
    flex: 1,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(2, 6, 23, 0.86)',
  },
  modalOverlayOpaque: {
    backgroundColor: '#020617',
  },
  modalSafeArea: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalCard: {
    backgroundColor: '#0C1B31',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.glassStrokeStrong,
    overflow: 'hidden',
  },
  modalContent: {
    padding: 18,
    paddingBottom: 22,
    gap: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  modalHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  modalCloseButton: {
    width: 44,
    height: 44,
    marginTop: -6,
    marginRight: -6,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgInteractive,
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '900',
    color: colors.textPrimary,
  },
  modalSubtitle: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  modalBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  modalSection: {
    gap: 6,
  },
  modalSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    color: colors.textSecondary,
  },
  modalSectionBody: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  modalMembershipNotice: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.accentRed,
    padding: 12,
    gap: 8,
  },
  modalActions: {
    gap: 10,
  },
  modalPrimaryButton: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  modalPrimaryButtonText: {
    fontSize: 14,
    fontWeight: '900',
    color: colors.textOnPrimary,
  },
  modalSecondaryButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderCard,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: colors.bgInteractive,
  },
  modalSecondaryButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.textPrimary,
  },
});
