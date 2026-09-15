import { useIsFocused, useRoute } from '@react-navigation/native';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import React from 'react';
import {
  Animated,
  FlatList,
  ScrollView,
  SectionList,
  StyleSheet,
  View,
  type FlatListProps,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
  type SectionListProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import { useFocusPaused } from '../context/FocusPauseContext';
import colors from '../theme/colors';
import { chooseFocusCandidate, createFocusScheduler, readVerticalScrollOffset } from './cardFocusMath';

type MeasurableNode = {
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
  getNativeScrollRef?: () => MeasurableNode | null;
  getScrollResponder?: () => MeasurableNode | null;
};

type Candidate = {
  id: string;
  token: number;
  ownerGeneration: number;
  measurementSequence: number;
  progress: Animated.Value;
  measure: (token: number) => void;
  top?: number;
  left?: number;
  height?: number;
  animation?: Animated.CompositeAnimation;
};

type CoordinatorOptions = {
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (id: number) => void;
};

export type FocusRegistration = (() => void) & { token: number };
export type CardFocusCoordinator = ReturnType<typeof createCardFocusCoordinator>;

const requestFrameDefault = (callback: () => void) => {
  if (typeof globalThis.requestAnimationFrame === 'function') return globalThis.requestAnimationFrame(callback);
  return setTimeout(callback, 16) as unknown as number;
};

const cancelFrameDefault = (id: number) => {
  if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(id);
  else clearTimeout(id);
};

export function createCardFocusCoordinator(options: CoordinatorOptions = {}) {
  const candidates = new Map<string, Candidate>();
  const dirtyCandidates = new Set<string>();
  const leases = new Set<number>();
  let viewportHeight = 0;
  let scrollOffset = 0;
  let surfacePageY: number | undefined;
  let winnerId: string | null = null;
  let active = true;
  let reduceMotion = false;
  let permanentlyDisposed = false;
  let ownerGeneration = 0;
  let geometryEpoch = 0;
  let surfaceMeasurementEpoch = 0;
  let registrationSequence = 0;
  let leaseSequence = 0;
  let scopeKey = 'default';
  let leaseMode = false;

  const stopAnimation = (candidate: Candidate) => {
    candidate.animation?.stop();
    candidate.animation = undefined;
  };

  const setCandidateFocused = (candidate: Candidate, focused: boolean) => {
    stopAnimation(candidate);
    const toValue = focused ? 1 : 0;
    if (reduceMotion || !active) {
      candidate.progress.setValue(toValue);
      return;
    }
    const animation = Animated.timing(candidate.progress, {
      toValue,
      duration: focused ? 170 : 130,
      useNativeDriver: true,
    });
    candidate.animation = animation;
    animation.start(() => {
      if (candidate.animation === animation) candidate.animation = undefined;
    });
  };

  const reset = () => {
    winnerId = null;
    for (const candidate of candidates.values()) {
      stopAnimation(candidate);
      candidate.progress.setValue(0);
    }
  };

  const evaluate = () => {
    if (permanentlyDisposed || !active) return;
    const nextWinner = chooseFocusCandidate(
      [...candidates.values()]
        .filter((candidate): candidate is Candidate & { top: number; height: number } => (
          candidate.ownerGeneration === ownerGeneration
          && candidate.top !== undefined
          && candidate.height !== undefined
        ))
        .map(({ id, top, left, height }) => ({ id, top, left, height })),
      { offset: scrollOffset, height: viewportHeight },
      winnerId,
    );
    if (nextWinner === winnerId) return;
    if (winnerId) {
      const previous = candidates.get(winnerId);
      if (previous) setCandidateFocused(previous, false);
    }
    winnerId = nextWinner;
    if (winnerId) {
      const next = candidates.get(winnerId);
      if (next) setCandidateFocused(next, true);
    }
  };

  const scheduler = createFocusScheduler(
    evaluate,
    options.requestFrame ?? requestFrameDefault,
    options.cancelFrame ?? cancelFrameDefault,
  );

  const requestMeasureAll = () => {
    if (!active || permanentlyDisposed) return;
    for (const candidate of candidates.values()) candidate.measure(candidate.token);
    scheduler.request();
  };

  // Wait for one unchanged geometry frame, then retry only outstanding samples.
  // Cells do not self-retry; an unavailable surface host gets at most two retries.
  let recoveryEpoch = -1;
  let surfaceRetriesRemaining = 0;
  let surfaceMeasurer: ((complete: (x: number, y: number) => void) => boolean) | undefined;
  const recovery = createFocusScheduler(() => {
    if (!active || permanentlyDisposed) return;
    if (recoveryEpoch !== geometryEpoch) {
      recoveryEpoch = geometryEpoch;
      recovery.request();
      return;
    }
    if (surfacePageY === undefined && surfaceRetriesRemaining > 0) {
      surfaceRetriesRemaining -= 1;
      const requested = surfaceMeasurer?.(api.captureSurfaceMeasurement());
      if (requested) surfaceRetriesRemaining = 0;
      if (!requested && surfaceRetriesRemaining > 0) recovery.request();
      // A real pending host callback will request fresh cell measurements.
      return;
    }
    for (const id of [...dirtyCandidates]) {
      const candidate = candidates.get(id);
      if (candidate) candidate.measure(candidate.token);
    }
  }, options.requestFrame ?? requestFrameDefault, options.cancelFrame ?? cancelFrameDefault);

  const setScopeKey = (nextScopeKey: string) => {
    if (nextScopeKey === scopeKey) return;
    scopeKey = nextScopeKey;
    recovery.cancel();
    dirtyCandidates.clear();
    surfaceRetriesRemaining = 0;
    ownerGeneration += 1;
    surfacePageY = undefined;
    geometryEpoch += 1;
    surfaceMeasurementEpoch += 1;
    reset();
    for (const [id, candidate] of candidates) {
      if (!id.startsWith(`${nextScopeKey}:`)) {
        stopAnimation(candidate);
        candidate.progress.setValue(0);
        candidates.delete(id);
        dirtyCandidates.delete(id);
        continue;
      }
      candidate.ownerGeneration = ownerGeneration;
      candidate.top = undefined;
      candidate.left = undefined;
      candidate.height = undefined;
    }
    requestMeasureAll();
  };

  const api = {
    requestSurfaceMeasurement(measure: (complete: (x: number, y: number) => void) => boolean) {
      if (!active || permanentlyDisposed) return;
      surfaceMeasurer = measure;
      surfaceRetriesRemaining = 2;
      if (surfaceMeasurer(api.captureSurfaceMeasurement())) surfaceRetriesRemaining = 0;
      else recovery.request();
    },
    register(id: string, progress: Animated.Value, measure: (token: number) => void): FocusRegistration {
      const previous = candidates.get(id);
      const token = ++registrationSequence;
      if (previous && previous.progress !== progress) {
        stopAnimation(previous);
        previous.progress.setValue(0);
      }
      const candidate: Candidate = {
        ...previous,
        id,
        token,
        ownerGeneration,
        measurementSequence: 0,
        progress,
        measure,
      };
      candidates.set(id, candidate);
      if (winnerId === id) progress.setValue(active ? 1 : 0);
      measure(token);
      scheduler.request();

      const unregister = (() => {
        const current = candidates.get(id);
        if (!current || current.token !== token) return;
        stopAnimation(current);
        current.progress.setValue(0);
        candidates.delete(id);
        dirtyCandidates.delete(id);
        if (winnerId === id) winnerId = null;
        scheduler.request();
      }) as FocusRegistration;
      unregister.token = token;
      return unregister;
    },
    updateLayout(id: string, top: number, height: number, token?: number, left = 0) {
      const candidate = candidates.get(id);
      if (!candidate
        || candidate.ownerGeneration !== ownerGeneration
        || (token !== undefined && candidate.token !== token)
        || !Number.isFinite(top)
        || !Number.isFinite(left)
        || !Number.isFinite(height)) return;
      candidate.top = top;
      candidate.left = left;
      candidate.height = height;
      dirtyCandidates.delete(id);
      scheduler.request();
    },
    captureMeasurement(id: string, token: number) {
      const registration = candidates.get(id);
      const measurement = registration?.token === token ? ++registration.measurementSequence : -1;
      if (measurement !== -1) dirtyCandidates.add(id);
      const capturedOwner = ownerGeneration;
      const capturedGeometryEpoch = geometryEpoch;
      const capturedOffset = scrollOffset;
      const capturedSurfacePageY = surfacePageY;
      return (pageX: number, pageY: number, _width: number, height: number) => {
        const candidate = candidates.get(id);
        if (!candidate
          || candidate.token !== token
          || candidate.measurementSequence !== measurement
          || candidate.ownerGeneration !== capturedOwner
          || ownerGeneration !== capturedOwner
          || capturedSurfacePageY === undefined
          || geometryEpoch !== capturedGeometryEpoch) return;
        api.updateLayout(id, pageY - capturedSurfacePageY + capturedOffset, height, token, pageX);
      };
    },
    updatePageLayout(id: string, pageY: number, height: number, token?: number, pageX = 0) {
      const candidate = candidates.get(id);
      if (!candidate) return;
      api.captureMeasurement(id, token ?? candidate.token)(pageX, pageY, 0, height);
    },
    captureSurfaceMeasurement() {
      const capturedOwner = ownerGeneration;
      const measurement = ++surfaceMeasurementEpoch;
      surfacePageY = undefined;
      geometryEpoch += 1;
      reset();
      for (const candidate of candidates.values()) candidate.top = undefined;
      return (_x: number, pageY: number) => {
        // The viewport host's window origin does not move when its own content
        // scrolls. Keep owner/request freshness, not the content-scroll epoch.
        if (!active || permanentlyDisposed || capturedOwner !== ownerGeneration
          || measurement !== surfaceMeasurementEpoch) return;
        api.setSurfacePageY(pageY);
        requestMeasureAll();
      };
    },
    setSurfacePageY(pageY: number) {
      if (!Number.isFinite(pageY) || pageY === surfacePageY) return;
      surfacePageY = pageY;
      geometryEpoch += 1;
    },
    setViewportHeight(height: number) {
      viewportHeight = Math.max(0, height);
      scheduler.request();
    },
    setScrollOffset(offset: number) {
      const nextOffset = Math.max(0, offset);
      if (nextOffset !== scrollOffset) geometryEpoch += 1;
      scrollOffset = nextOffset;
      if (dirtyCandidates.size > 0) recovery.request();
      scheduler.request();
    },
    requestMeasureAll,
    setScopeKey,
    acquire(nextScopeKey = scopeKey) {
      leaseMode = true;
      setScopeKey(nextScopeKey);
      const lease = ++leaseSequence;
      leases.add(lease);
      active = true;
      requestMeasureAll();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        leases.delete(lease);
        if (leases.size > 0) return;
        active = false;
        surfaceMeasurementEpoch += 1;
        geometryEpoch += 1;
        scheduler.cancel();
        recovery.cancel();
        reset();
      };
    },
    setActive(nextActive: boolean) {
      if (leaseMode && nextActive && leases.size === 0) return;
      active = nextActive;
      if (!active) {
        surfaceMeasurementEpoch += 1;
        geometryEpoch += 1;
        scheduler.cancel();
        recovery.cancel();
        reset();
      } else requestMeasureAll();
    },
    setReduceMotion(nextReduceMotion: boolean) {
      reduceMotion = nextReduceMotion;
      for (const candidate of candidates.values()) {
        stopAnimation(candidate);
        candidate.progress.setValue(candidate.id === winnerId && active ? 1 : 0);
      }
    },
    dispose() {
      permanentlyDisposed = true;
      leases.clear();
      scheduler.dispose();
      recovery.dispose();
      dirtyCandidates.clear();
      reset();
      candidates.clear();
    },
  };

  return api;
}

type CardFocusContextValue = { coordinator: CardFocusCoordinator; scopeKey: string };
const CardFocusContext = React.createContext<CardFocusContextValue | CardFocusCoordinator | null>(null);
const InsideFocusCardContext = React.createContext(false);

function assignRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === 'function') ref(value);
  else if (ref) ref.current = value;
}

function resolveMeasurableNode(value: unknown): MeasurableNode | null {
  const node = value as MeasurableNode | null;
  if (!node) return null;
  const nativeScrollRef = node.getNativeScrollRef?.();
  if (nativeScrollRef?.measureInWindow) return nativeScrollRef;
  const responder = node.getScrollResponder?.();
  if (responder?.measureInWindow) return responder;
  const responderNativeRef = responder?.getNativeScrollRef?.();
  if (responderNativeRef?.measureInWindow) return responderNativeRef;
  return node.measureInWindow ? node : null;
}

function routeScope(route: { key?: string; name?: string; params?: unknown }, focusScopeKey?: string) {
  let params = '';
  try {
    params = JSON.stringify(route.params ?? null);
  } catch {
    params = '[unserializable]';
  }
  return `${route.key ?? route.name ?? 'route'}:${params}:${focusScopeKey ?? 'default'}`;
}

function useFocusSurface<T>(forwardedRef: React.ForwardedRef<T>, focusScopeKey?: string, focusEnabled = true) {
  const isFocused = useIsFocused();
  const route = useRoute() as { key?: string; name?: string; params?: unknown };
  const { reduceMotion } = useAccessibilityPreferences();
  const globallyPaused = useFocusPaused();
  const nativeRef = React.useRef<T | null>(null);
  const coordinator = React.useMemo(() => createCardFocusCoordinator(), []);
  const ownerKey = routeScope(route, focusScopeKey);
  const contextValue = React.useMemo(() => ({ coordinator, scopeKey: ownerKey }), [coordinator, ownerKey]);

  const setRef = React.useCallback((node: T | null) => {
    nativeRef.current = node;
    assignRef(forwardedRef, node);
  }, [forwardedRef]);

  const measureSurface = React.useCallback(() => {
    coordinator.requestSurfaceMeasurement((complete) => {
      const host = resolveMeasurableNode(nativeRef.current);
      if (!host?.measureInWindow) return false;
      host.measureInWindow(complete);
      return true;
    });
  }, [coordinator]);

  React.useEffect(() => {
    coordinator.setReduceMotion(reduceMotion);
  }, [coordinator, reduceMotion]);
  React.useEffect(() => {
    coordinator.setScopeKey(ownerKey);
    if (!isFocused || !focusEnabled || globallyPaused) {
      coordinator.setActive(false);
      return undefined;
    }
    const release = coordinator.acquire(ownerKey);
    measureSurface();
    return release;
  }, [coordinator, focusEnabled, globallyPaused, isFocused, measureSurface, ownerKey]);

  return { contextValue, coordinator, measureSurface, setRef };
}

type FocusSurfaceProps = { focusScopeKey?: string; focusEnabled?: boolean; includeBottomTabInset?: boolean };

export function useBottomTabContentInset() {
  return React.useContext(BottomTabBarHeightContext) ?? 0;
}

function useInsetContentContainerStyle(contentContainerStyle: ScrollViewProps['contentContainerStyle'], includeBottomTabInset: boolean) {
  const bottomTabInset = useBottomTabContentInset();
  if (!includeBottomTabInset || bottomTabInset <= 0) return contentContainerStyle;
  const flattened = StyleSheet.flatten(contentContainerStyle);
  const effectiveBottomPadding = flattened?.paddingBottom ?? flattened?.paddingVertical ?? flattened?.padding;
  const existingPadding = typeof effectiveBottomPadding === 'number' && Number.isFinite(effectiveBottomPadding)
    ? effectiveBottomPadding
    : 0;
  return [contentContainerStyle, { paddingBottom: existingPadding + bottomTabInset }];
}

export const FocusScrollView = React.forwardRef<ScrollView, ScrollViewProps & FocusSurfaceProps>(function FocusScrollView(
  { children, contentContainerStyle, focusEnabled, focusScopeKey, includeBottomTabInset = true, onContentSizeChange, onLayout, onScroll, scrollEventThrottle, ...props },
  forwardedRef,
) {
  const { contextValue, coordinator, measureSurface, setRef } = useFocusSurface<ScrollView>(forwardedRef, focusScopeKey, focusEnabled);
  const insetContentContainerStyle = useInsetContentContainerStyle(contentContainerStyle, includeBottomTabInset);
  const handleLayout = React.useCallback((event: LayoutChangeEvent) => {
    coordinator.setViewportHeight(event.nativeEvent.layout.height);
    measureSurface();
    onLayout?.(event);
  }, [coordinator, measureSurface, onLayout]);
  const handleScroll = React.useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    coordinator.setScrollOffset(readVerticalScrollOffset(event));
    onScroll?.(event);
  }, [coordinator, onScroll]);
  const handleContentSizeChange = React.useCallback((width: number, height: number) => {
    coordinator.requestMeasureAll();
    onContentSizeChange?.(width, height);
  }, [coordinator, onContentSizeChange]);

  return (
    <CardFocusContext.Provider value={contextValue}>
      <ScrollView {...props} ref={setRef} contentContainerStyle={insetContentContainerStyle} onLayout={handleLayout} onScroll={handleScroll} onContentSizeChange={handleContentSizeChange} scrollEventThrottle={scrollEventThrottle ?? 32}>
        {children}
      </ScrollView>
    </CardFocusContext.Provider>
  );
});

type FocusFlatListProps<ItemT> = FlatListProps<ItemT> & FocusSurfaceProps & {
  focusKeyExtractor?: (item: ItemT, index: number) => string;
  focusItems?: boolean;
};

function FocusFlatListInner<ItemT>(
  { contentContainerStyle, focusEnabled, focusItems = true, focusKeyExtractor, focusScopeKey, includeBottomTabInset = true, keyExtractor, renderItem, onContentSizeChange, onLayout, onScroll, scrollEventThrottle, ...props }: FocusFlatListProps<ItemT>,
  forwardedRef: React.ForwardedRef<FlatList<ItemT>>,
) {
  const { contextValue, coordinator, measureSurface, setRef } = useFocusSurface<FlatList<ItemT>>(forwardedRef, focusScopeKey, focusEnabled);
  const insetContentContainerStyle = useInsetContentContainerStyle(contentContainerStyle, includeBottomTabInset);
  const wrappedRenderItem = React.useCallback((info: Parameters<NonNullable<FlatListProps<ItemT>['renderItem']>>[0]) => {
    const rendered = renderItem?.(info) ?? null;
    if (!focusItems) return rendered;
    const id = focusKeyExtractor?.(info.item, info.index)
      ?? keyExtractor?.(info.item, info.index)
      ?? String((info.item as { id?: unknown; key?: unknown })?.id ?? (info.item as { key?: unknown })?.key ?? info.index);
    return <FocusCard focusId={`list:${id}`}>{rendered}</FocusCard>;
  }, [focusItems, focusKeyExtractor, keyExtractor, renderItem]);

  return (
    <CardFocusContext.Provider value={contextValue}>
      <FlatList {...props} ref={setRef} contentContainerStyle={insetContentContainerStyle} keyExtractor={keyExtractor} renderItem={wrappedRenderItem}
        onLayout={(event) => { coordinator.setViewportHeight(event.nativeEvent.layout.height); measureSurface(); onLayout?.(event); }}
        onScroll={(event) => { coordinator.setScrollOffset(readVerticalScrollOffset(event)); onScroll?.(event); }}
        onContentSizeChange={(width, height) => { coordinator.requestMeasureAll(); onContentSizeChange?.(width, height); }}
        scrollEventThrottle={scrollEventThrottle ?? 32}
      />
    </CardFocusContext.Provider>
  );
}

export const FocusFlatList = React.forwardRef(FocusFlatListInner) as <ItemT>(props: FocusFlatListProps<ItemT> & { ref?: React.ForwardedRef<FlatList<ItemT>> }) => React.ReactElement;

type FocusSectionListProps<ItemT, SectionT> = SectionListProps<ItemT, SectionT> & FocusSurfaceProps & {
  focusKeyExtractor?: (item: ItemT, index: number) => string;
  focusItems?: boolean;
};

function FocusSectionListInner<ItemT, SectionT>(
  { contentContainerStyle, focusEnabled, focusItems = true, focusKeyExtractor, focusScopeKey, includeBottomTabInset = true, keyExtractor, renderItem, onContentSizeChange, onLayout, onScroll, scrollEventThrottle, ...props }: FocusSectionListProps<ItemT, SectionT>,
  forwardedRef: React.ForwardedRef<SectionList<ItemT, SectionT>>,
) {
  const { contextValue, coordinator, measureSurface, setRef } = useFocusSurface<SectionList<ItemT, SectionT>>(forwardedRef, focusScopeKey, focusEnabled);
  const insetContentContainerStyle = useInsetContentContainerStyle(contentContainerStyle, includeBottomTabInset);
  const wrappedRenderItem = React.useCallback((info: Parameters<NonNullable<SectionListProps<ItemT, SectionT>['renderItem']>>[0]) => {
    const rendered = renderItem?.(info) ?? null;
    if (!focusItems) return rendered;
    const id = focusKeyExtractor?.(info.item, info.index)
      ?? keyExtractor?.(info.item, info.index)
      ?? String((info.item as { id?: unknown; key?: unknown })?.id ?? (info.item as { key?: unknown })?.key ?? info.index);
    return <FocusCard focusId={`section:${id}`}>{rendered}</FocusCard>;
  }, [focusItems, focusKeyExtractor, keyExtractor, renderItem]);

  return (
    <CardFocusContext.Provider value={contextValue}>
      <SectionList {...props} ref={setRef} contentContainerStyle={insetContentContainerStyle} keyExtractor={keyExtractor} renderItem={wrappedRenderItem}
        onLayout={(event) => { coordinator.setViewportHeight(event.nativeEvent.layout.height); measureSurface(); onLayout?.(event); }}
        onScroll={(event) => { coordinator.setScrollOffset(readVerticalScrollOffset(event)); onScroll?.(event); }}
        onContentSizeChange={(width, height) => { coordinator.requestMeasureAll(); onContentSizeChange?.(width, height); }}
        scrollEventThrottle={scrollEventThrottle ?? 32}
      />
    </CardFocusContext.Provider>
  );
}

export const FocusSectionList = React.forwardRef(FocusSectionListInner) as <ItemT, SectionT>(props: FocusSectionListProps<ItemT, SectionT> & { ref?: React.ForwardedRef<SectionList<ItemT, SectionT>> }) => React.ReactElement;

export function FocusCard({ children, focusId, focusScopeKey, accentColor = colors.primary, style, testID }: {
  children: React.ReactNode;
  focusId: string;
  focusScopeKey?: string;
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const context = React.useContext(CardFocusContext);
  const insideFocusCard = React.useContext(InsideFocusCardContext);
  const coordinator = context && 'coordinator' in context ? context.coordinator : context;
  const inheritedScopeKey = context && 'scopeKey' in context ? context.scopeKey : 'default';
  const { reduceMotion } = useAccessibilityPreferences();
  const nodeRef = React.useRef<React.ComponentRef<typeof View>>(null);
  const registrationTokenRef = React.useRef<number | null>(null);
  const [progress] = React.useState(() => new Animated.Value(0));
  const candidateId = `${inheritedScopeKey}:${focusScopeKey ?? 'card'}:${focusId}`;
  const wrapperTestID = testID ?? `focus-card-${focusId}`;

  const measure = React.useCallback((suppliedToken?: number) => {
    const token = suppliedToken ?? registrationTokenRef.current;
    if (!coordinator || token === null || token === undefined) return;
    const complete = coordinator.captureMeasurement(candidateId, token);
    resolveMeasurableNode(nodeRef.current)?.measureInWindow?.(complete);
  }, [candidateId, coordinator]);

  React.useEffect(() => {
    if (!coordinator || insideFocusCard) return undefined;
    const registration = coordinator.register(candidateId, progress, measure);
    registrationTokenRef.current = registration.token;
    return () => {
      if (registrationTokenRef.current === registration.token) registrationTokenRef.current = null;
      registration();
    };
  }, [candidateId, coordinator, insideFocusCard, measure, progress]);

  return (
    <View ref={nodeRef} collapsable={false} testID={wrapperTestID} onLayout={() => measure()} style={style}>
      <InsideFocusCardContext.Provider value>{children}</InsideFocusCardContext.Provider>
      <Animated.View testID={`${wrapperTestID}-emphasis`} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[styles.focusEdge, { borderColor: accentColor, shadowColor: accentColor, opacity: progress }, reduceMotion && styles.reducedMotionEdge]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  focusEdge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    borderWidth: 1.5,
    shadowOpacity: 0.42,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  reducedMotionEdge: { shadowOpacity: 0.3 },
});
