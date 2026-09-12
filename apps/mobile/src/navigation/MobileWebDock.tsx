import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import TeamLogo from '../components/TeamLogo';
import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../context/LeagueContext';
import colors from '../theme/colors';
import { getSurfacePalette } from '../theme/ui';
import { buildMoreMenu, type DockDestination, type MoreMenuItem } from './dockMenu';
import { createDockModalLifecycle, type ModalSnapshot } from './dockModalLifecycle';
import { getDockAccessibilityVisuals, getMobileDockLayout } from './layout';
import { useMobileDockData } from './useMobileDockData';

const CONTROLS = [
  { key: 'Standings', label: 'Standings', icon: 'trophy-outline' },
  { key: 'Schedule', label: 'Schedule', icon: 'calendar-outline' },
  { key: 'Team', label: 'Team', icon: 'shield-outline' },
  { key: 'Stats', label: 'Stats', icon: 'stats-chart-outline' },
  { key: 'More', label: 'More', icon: 'ellipsis-horizontal' },
] as const;

function currentRouteName(state: BottomTabBarProps['state']) {
  return state.routes[state.index]?.name ?? 'Home';
}

function activeRouteIdentity(state: BottomTabBarProps['state']): string {
  type NestedState = {
    index?: number;
    routes?: ReadonlyArray<{ key?: string; name?: string; state?: NestedState }>;
  };
  const parts: string[] = [];
  let current: NestedState | undefined = state as unknown as NestedState;
  while (current?.routes?.length) {
    const route: NonNullable<NestedState['routes']>[number] | undefined = current.routes[current.index ?? 0];
    if (!route) break;
    parts.push(route.key ?? route.name ?? 'unknown');
    current = route.state;
  }
  return parts.join('>');
}

export default function MobileWebDock({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const { reduceMotion, reduceTransparency } = useAccessibilityPreferences();
  const { user, isGuest } = useAuth();
  const { activeLeague, activeTheme, isGuestLeague } = useLeague();
  const data = useMobileDockData(activeLeague?.id ?? null, user?.id ?? null);
  const [modal, setModal] = React.useState<ModalSnapshot>({ mounted: false, open: false });
  const [keyboardVisible, setKeyboardVisible] = React.useState(false);
  const [progress] = React.useState(() => new Animated.Value(0));
  const animateModal = React.useCallback((open: boolean, complete: (finished: boolean) => void) => {
      progress.stopAnimation();
      if (reduceMotion) {
        progress.setValue(open ? 1 : 0);
        complete(true);
        return;
      }
      const animation = open
        ? Animated.spring(progress, {
            toValue: 1,
            damping: 20,
            stiffness: 220,
            mass: 0.8,
            useNativeDriver: true,
          })
        : Animated.timing(progress, {
            toValue: 0,
            duration: 190,
            useNativeDriver: true,
          });
      animation.start(({ finished }) => complete(finished));
  }, [progress, reduceMotion]);
  const [lifecycle] = React.useState(() => createDockModalLifecycle(animateModal, setModal));
  React.useEffect(() => lifecycle.setAnimator(animateModal), [animateModal, lifecycle]);
  React.useEffect(() => {
    lifecycle.activate();
    return () => {
      progress.stopAnimation();
      lifecycle.dispose();
    };
  }, [lifecycle, progress]);

  const identityKey = `${user?.id ?? 'guest'}:${activeLeague?.id ?? 'none'}`;
  const routeIdentity = activeRouteIdentity(state);
  React.useEffect(() => {
    progress.stopAnimation();
    progress.setValue(0);
    lifecycle.reset();
  }, [identityKey, lifecycle, progress, routeIdentity]);

  React.useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSubscription = Keyboard.addListener(showEvent, () => {
      progress.stopAnimation();
      progress.setValue(0);
      lifecycle.reset();
      setKeyboardVisible(true);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [lifecycle, progress]);

  const isMember = Boolean(user && activeLeague && !isGuest && !isGuestLeague);
  const isCaptain = isMember && ['captain', 'alternate_captain'].includes(data.team?.leadership_role ?? '');
  const items = React.useMemo(() => buildMoreMenu({
    leagueSlug: data.websiteStatus === 'ready' ? activeLeague?.slug ?? '' : '',
    visiblePages: data.visiblePages,
    customNavItems: data.customNavItems,
    isPlayoffs: data.isPlayoffs,
    registrationOpen: data.registrationOpen,
    userId: user?.id,
    isMember,
    isCaptain,
  }), [activeLeague?.slug, data.customNavItems, data.isPlayoffs, data.registrationOpen, data.visiblePages, data.websiteStatus, isCaptain, isMember, user?.id]);

  const navigate = React.useCallback((destination: DockDestination) => {
    if (destination.kind === 'external') {
      void Linking.openURL(destination.url).catch(() => {});
      return;
    }
    if (destination.screen) {
      navigation.navigate(destination.tab, { screen: destination.screen, params: destination.params });
    } else {
      navigation.navigate(destination.tab);
    }
  }, [navigation]);

  const selectMoreItem = React.useCallback((item: MoreMenuItem) => {
    lifecycle.close(() => navigate(item.destination));
  }, [lifecycle, navigate]);

  const pressRegisteredTab = React.useCallback((tab: 'Standings' | 'Schedule' | 'Team' | 'Stats', destination?: DockDestination) => {
    const routeIndex = state.routes.findIndex((route) => route.name === tab);
    const route = state.routes[routeIndex];
    if (!route) return;

    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (event.defaultPrevented) return;

    if (destination) {
      // Team always resolves to the current assignment. Prevent the native-stack
      // deferred pop-to-top listener from racing that explicit destination.
      event.preventDefault();
      navigate(destination);
      return;
    }

    if (routeIndex !== state.index) navigation.navigate(tab);
  }, [navigate, navigation, state.index, state.routes]);

  const pressControl = React.useCallback((key: (typeof CONTROLS)[number]['key']) => {
    if (key === 'More') {
      lifecycle.open();
      return;
    }
    if (key === 'Team') {
      const destination: DockDestination = data.team && activeLeague
        ? { kind: 'native', tab: 'Team', screen: 'TeamDetail', params: { teamId: data.team.team_id, leagueId: activeLeague.id } }
        : { kind: 'native', tab: 'Team', screen: 'TeamList' };
      pressRegisteredTab('Team', destination);
      return;
    }
    pressRegisteredTab(key);
  }, [activeLeague, data.team, lifecycle, pressRegisteredTab]);

  const routeName = currentRouteName(state);
  const hiddenRouteIsActive = ['Home', 'Discover', 'Profile', 'Captain'].includes(routeName);
  const palette = getSurfacePalette(reduceTransparency);
  const primary = activeTheme.primaryColor || colors.primary;
  const secondary = activeTheme.secondaryColor || colors.brandArena;
  const categories = React.useMemo(() => {
    const grouped = new Map<MoreMenuItem['category'], MoreMenuItem[]>();
    for (const item of items) grouped.set(item.category, [...(grouped.get(item.category) ?? []), item]);
    return [...grouped.entries()];
  }, [items]);
  const layout = getMobileDockLayout(width, insets.bottom, height, insets.top);
  const accessibleVisuals = getDockAccessibilityVisuals(reduceMotion, reduceTransparency);
  const tileWidth = `${100 / layout.tileColumns}%` as const;

  if (keyboardVisible) return null;

  return (
    <View testID="mobile-web-dock" style={[styles.dockOuter, { height: layout.outerHeight, paddingHorizontal: layout.horizontalPadding, paddingBottom: Math.max(insets.bottom, 6), paddingTop: layout.topPadding }]} pointerEvents="box-none">
      <View testID="dock-surface" accessibilityLabel="Primary navigation" style={[styles.dockShadow, { borderColor: `${primary}38` }]}>
        <LinearGradient
          colors={reduceTransparency ? [palette.elevated, palette.elevated] : ['rgba(5, 9, 18, 0.99)', 'rgba(13, 23, 40, 0.985)', 'rgba(7, 13, 25, 0.99)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <LinearGradient
          pointerEvents="none"
          colors={[`${primary}22`, 'transparent', `${secondary}18`]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.dockSheen} pointerEvents="none" />
        <View style={styles.dockInnerRim} pointerEvents="none" />
        <View style={styles.controlsRow}>
          {CONTROLS.map((control) => {
            const active = control.key === 'More'
              ? modal.open || hiddenRouteIsActive
              : routeName === control.key;
            const isTeam = control.key === 'Team';
            return (
              <Pressable
                key={control.key}
                testID={`dock-${control.key.toLowerCase()}`}
                accessibilityRole="button"
                accessibilityLabel={`${control.label}${isTeam && data.team ? `, ${data.team.team_name}` : ''}`}
                accessibilityState={{ selected: active }}
                aria-selected={active}
                hitSlop={isTeam ? 0 : 4}
                onPress={() => pressControl(control.key)}
                style={({ pressed }) => [
                  styles.control,
                  { minWidth: layout.touchMin, minHeight: layout.touchMin },
                  !isTeam && active && [styles.controlActive, { borderColor: `${primary}48`, shadowColor: primary }],
                  isTeam && [styles.teamControl, {
                    flexBasis: layout.teamColumnWidth,
                    width: layout.teamColumnWidth,
                    minWidth: layout.teamColumnWidth,
                    maxWidth: layout.teamColumnWidth,
                  }],
                  pressed && styles.controlPressed,
                ]}
              >
                {isTeam ? (
                  <View testID="dock-team-crest" pointerEvents="none" style={[styles.crestWell, { width: layout.crestSize, height: layout.crestSize, borderRadius: layout.crestSize / 2, borderColor: active ? primary : 'rgba(255,255,255,0.22)', shadowColor: active ? primary : '#000000' }]}>
                    {data.isLoading ? (
                      <ActivityIndicator color={primary} />
                    ) : data.team ? (
                      <TeamLogo
                        teamId={data.team.team_id}
                        logoUrl={data.team.logo_url}
                        teamName={data.team.team_name}
                        primaryColor={data.team.primary_color}
                        size={layout.crestArtSize}
                        transparentBacking
                      />
                    ) : (
                      <Ionicons name="shield-outline" size={38} color={active ? primary : colors.textSecondary} />
                    )}
                  </View>
                ) : (
                  <Ionicons name={control.icon} size={22} color={active ? colors.textPrimary : '#D5DEEC'} />
                )}
                {!isTeam ? (
                  // Fixed dock labels cap scaling to fit reserved columns; content remains scalable.
                  <Text numberOfLines={1} maxFontSizeMultiplier={layout.compact ? 1 : 1.1} style={[styles.controlLabel, active && { color: colors.textPrimary }, layout.compact && styles.compactLabel]}>
                    {control.label}
                  </Text>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>

      <Modal
        transparent
        statusBarTranslucent
        visible={modal.mounted}
        animationType="none"
        onRequestClose={() => lifecycle.close()}
      >
        <View style={styles.modalRoot} accessibilityViewIsModal accessibilityLabel="More navigation">
          <Animated.View style={[styles.backdrop, { opacity: progress }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close more menu"
              style={StyleSheet.absoluteFill}
              onPress={() => lifecycle.close()}
            />
          </Animated.View>
          <Animated.View
            testID="more-sheet"
            style={[
              styles.sheet,
              {
                maxHeight: layout.sheetMaxHeight,
                marginBottom: Math.max(insets.bottom, 12),
                borderColor: `${primary}55`,
                backgroundColor: reduceTransparency ? palette.elevated : 'rgba(8, 15, 29, 0.96)',
                opacity: accessibleVisuals.fadeSheet ? progress : 1,
                transform: accessibleVisuals.animate ? [
                  { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [42, 0] }) },
                  { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
                ] : [],
              },
            ]}
          >
            {accessibleVisuals.glassGradient ? (
              <LinearGradient
                colors={[`${primary}35`, 'rgba(12, 20, 36, 0.95)', `${secondary}20`]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <View style={styles.sheetSheen} pointerEvents="none" />
            <View style={styles.sheetHeader}>
              <View style={[styles.leagueMark, { borderColor: `${primary}55` }]}>
                {activeLeague?.logoUrl ? (
                  <Animated.Image source={{ uri: activeLeague.logoUrl }} style={styles.leagueLogo} accessibilityLabel={activeLeague.name} alt={activeLeague.name} />
                ) : (
                  <Ionicons name="trophy-outline" size={26} color={primary} />
                )}
              </View>
              <View style={styles.sheetHeaderCopy}>
                <Text style={styles.sheetEyebrow}>LEAGUE NAVIGATION</Text>
                <Text style={styles.sheetTitle}>{activeLeague?.name ?? 'Explore leagues'}</Text>
                <Text style={styles.sheetSubtitle}>Every page, one smooth move away</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close more menu"
                onPress={() => lifecycle.close()}
                style={({ pressed }) => [styles.closeButton, pressed && styles.controlPressed]}
              >
                <Ionicons name="close" size={24} color={colors.textPrimary} />
              </Pressable>
            </View>
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={[styles.sheetScroll, { paddingBottom: Math.max(18, insets.bottom) }]}
            >
              {activeLeague && data.websiteStatus === 'loading' ? (
                <View style={styles.metadataStatus} accessibilityLiveRegion="polite">
                  <ActivityIndicator color={primary} />
                  <Text style={styles.metadataStatusTitle}>Loading league navigation</Text>
                  <Text style={styles.metadataStatusCopy}>League website choices will appear when verified.</Text>
                </View>
              ) : null}
              {activeLeague && data.websiteStatus === 'error' ? (
                <View style={styles.metadataStatus} accessibilityLiveRegion="polite">
                  <Text style={styles.metadataStatusTitle}>League navigation unavailable</Text>
                  <Text style={styles.metadataStatusCopy}>Home, Discover, and Account are still available.</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Retry league navigation"
                    onPress={data.retry}
                    style={({ pressed }) => [styles.retryButton, { borderColor: `${primary}88` }, pressed && styles.controlPressed]}
                  >
                    <Text style={[styles.retryLabel, { color: primary }]}>Retry</Text>
                  </Pressable>
                </View>
              ) : null}
              {categories.map(([category, categoryItems]) => (
                <View key={category} style={styles.category}>
                  <Text style={[styles.categoryLabel, { color: primary }]}>{category}</Text>
                  <View style={styles.tileGrid}>
                    {categoryItems.map((item) => (
                      <Pressable
                        key={item.key}
                        accessibilityRole={item.destination.kind === 'external' ? 'link' : 'button'}
                        accessibilityLabel={item.label}
                        onPress={() => selectMoreItem(item)}
                        style={({ pressed }) => [styles.tile, { width: tileWidth }, layout.compact && styles.tileCompact, pressed && styles.tilePressed]}
                      >
                        <View style={[styles.tileIcon, { backgroundColor: `${primary}18` }]}>
                          <Ionicons name={item.icon as never} size={22} color={primary} />
                        </View>
                        <Text style={styles.tileLabel}>{item.label}</Text>
                        {item.destination.kind === 'external' ? (
                          <Ionicons name="open-outline" size={12} color={colors.textSecondary} style={styles.externalIcon} />
                        ) : null}
                      </Pressable>
                    ))}
                  </View>
                </View>
              ))}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  dockOuter: { backgroundColor: colors.bgBase },
  dockShadow: {
    flex: 1, minHeight: 70, borderRadius: 23, borderWidth: StyleSheet.hairlineWidth, overflow: 'visible',
    backgroundColor: '#080F1C', shadowColor: '#000', shadowOffset: { width: 0, height: 9 },
    shadowOpacity: 0.5, shadowRadius: 20, elevation: 18,
  },
  dockSheen: { position: 'absolute', top: 1, right: 24, left: 24, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.3)' },
  dockInnerRim: { ...StyleSheet.absoluteFillObject, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.07)' },
  controlsRow: { flex: 1, flexDirection: 'row', alignItems: 'stretch' },
  control: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 44, minHeight: 44, marginVertical: 7, marginHorizontal: 0, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center', gap: 4, paddingTop: 2 },
  controlActive: { backgroundColor: 'rgba(255,255,255,0.085)', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 2 },
  teamControl: { flexGrow: 0, flexShrink: 0, marginTop: -38, marginBottom: 0, minHeight: 106, paddingTop: 0, justifyContent: 'flex-start', backgroundColor: 'transparent', borderColor: 'transparent' },
  controlPressed: { opacity: 0.68, transform: [{ scale: 0.97 }] },
  controlLabel: { color: '#B8C4D6', fontSize: 10, lineHeight: 13, fontWeight: '800', letterSpacing: 0 },
  compactLabel: { fontSize: 9 },
  crestWell: {
    borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#07101D',
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.44, shadowRadius: 14, elevation: 16,
  },
  modalRoot: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: 12 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(1, 5, 12, 0.78)' },
  sheet: {
    overflow: 'hidden', borderRadius: 30, borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.55, shadowRadius: 28, elevation: 30,
  },
  sheetSheen: { position: 'absolute', top: 1, right: 26, left: 26, height: 1, backgroundColor: 'rgba(255,255,255,0.3)' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 15, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  leagueMark: { width: 54, height: 54, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  leagueLogo: { width: 48, height: 48, borderRadius: 15, resizeMode: 'contain' },
  sheetHeaderCopy: { flex: 1 },
  sheetEyebrow: { color: colors.textSecondary, fontSize: 9, fontWeight: '900', letterSpacing: 1.8 },
  sheetTitle: { color: colors.textPrimary, fontSize: 20, lineHeight: 24, fontWeight: '900', marginTop: 1 },
  sheetSubtitle: { color: colors.textSecondary, fontSize: 11, lineHeight: 15, marginTop: 2 },
  closeButton: { width: 44, height: 44, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' },
  sheetScroll: { paddingHorizontal: 12, paddingTop: 10 },
  metadataStatus: { alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 14 },
  metadataStatusTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '800', textAlign: 'center' },
  metadataStatusCopy: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  retryButton: { minWidth: 88, minHeight: 44, marginTop: 3, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  retryLabel: { fontSize: 13, fontWeight: '900' },
  category: { marginTop: 9 },
  categoryLabel: { paddingHorizontal: 6, marginBottom: 7, fontSize: 10, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase' },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  tile: { minHeight: 88, padding: 3, alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 18 },
  tileCompact: { minHeight: 82 },
  tilePressed: { backgroundColor: 'rgba(255,255,255,0.08)', transform: [{ scale: 0.96 }] },
  tileIcon: { width: 43, height: 43, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)' },
  tileLabel: { color: colors.textPrimary, fontSize: 11, lineHeight: 14, fontWeight: '700', textAlign: 'center', paddingHorizontal: 2 },
  externalIcon: { position: 'absolute', top: 11, right: 14 },
});
