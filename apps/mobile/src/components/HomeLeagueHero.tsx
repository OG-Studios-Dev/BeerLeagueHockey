import { useIsFocused } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import {
  Animated,
  AppState,
  type AppStateStatus,
  Easing,
  Image,
  type ImageSourcePropType,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import hockeyLifeLogo from '../../assets/hockey-life-logo.png';

const HOCKEY_LIFE_LEAGUE_ID = 'd6e55507-6eae-4d94-978c-47c6c30a36f1';
const HOCKEY_LIFE_CANONICAL_LOGO_URL = 'https://ntplczcmhvfkijjxavdl.supabase.co/storage/v1/object/public/league-logos/wizard-add94b26-b344-459f-9727-8cddae9783de-1773170120557.jpg';

type Props = {
  leagueId: string;
  leagueName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  reduceMotion: boolean;
  reduceTransparency: boolean;
  width: number;
  height: number;
  updatesAction?: React.ReactNode;
};

export function resolveHomeLeagueLogoSource(leagueId: string, logoUrl: string | null): ImageSourcePropType | null {
  if (leagueId === HOCKEY_LIFE_LEAGUE_ID || logoUrl === HOCKEY_LIFE_CANONICAL_LOGO_URL) return hockeyLifeLogo;
  return logoUrl ? { uri: logoUrl } : null;
}

function initialsFor(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || 'BL';
}

function getHeroGeometry(width: number, height: number) {
  if (height <= 620) {
    const markSize = Math.min(205, Math.max(188, width - 115));
    return { markSize, stageWidth: Math.min(width - 12, markSize + 70), stageHeight: 166, mastheadHeight: 184 };
  }
  if (width < 600) {
    const markSize = Math.min(252, Math.max(224, width - 140));
    return { markSize, stageWidth: Math.min(width - 16, markSize + 70), stageHeight: 194, mastheadHeight: 234 };
  }
  const markSize = Math.min(270, width - 220);
  return { markSize, stageWidth: markSize + 84, stageHeight: 214, mastheadHeight: 254 };
}

function HomeLeagueHeroAnimated({
  leagueId,
  leagueName,
  logoUrl,
  primaryColor,
  secondaryColor,
  reduceMotion,
  reduceTransparency,
  width,
  height,
  updatesAction,
}: Props) {
  const isFocused = useIsFocused();
  const identityKey = `${leagueId}:${logoUrl ?? 'fallback'}`;
  const source = resolveHomeLeagueLogoSource(leagueId, logoUrl);
  const requestToken = React.useMemo(() => ({ identityKey }), [identityKey]);
  const currentRequest = React.useRef(requestToken);
  React.useLayoutEffect(() => {
    currentRequest.current = requestToken;
  }, [requestToken]);
  const [imageState, setImageState] = React.useState<{ requestToken: typeof requestToken; status: 'pending' | 'loaded' | 'failed' }>(() => ({
    requestToken,
    status: source ? 'pending' : 'failed',
  }));
  const imageStatus = imageState.requestToken === requestToken
    ? imageState.status
    : source ? 'pending' : 'failed';
  const handleImageLoad = React.useCallback(() => {
    if (currentRequest.current !== requestToken) return;
    setImageState((previous) => previous.requestToken === requestToken && previous.status === 'loaded'
      ? previous : { requestToken, status: 'loaded' });
  }, [requestToken]);
  const handleImageError = React.useCallback(() => {
    if (currentRequest.current !== requestToken) return;
    setImageState((previous) => previous.requestToken === requestToken && previous.status === 'failed'
      ? previous : { requestToken, status: 'failed' });
  }, [requestToken]);
  const [appState, setAppState] = React.useState<AppStateStatus | null>(() => AppState.currentState);
  const [opacity] = React.useState(() => new Animated.Value(0));
  const [rise] = React.useState(() => new Animated.Value(22));
  const [scale] = React.useState(() => new Animated.Value(0.94));
  const [sweep] = React.useState(() => new Animated.Value(-1));
  const animation = React.useRef<Animated.CompositeAnimation | null>(null);
  const animationToken = React.useRef(0);
  const animatedRequest = React.useRef<typeof requestToken | null>(null);
  const transparencyPreference = React.useRef(reduceTransparency);
  const geometry = getHeroGeometry(width, height);
  const { markSize, stageWidth } = geometry;
  // Only the verified padded monogram can safely use a shorter stage.
  const stageHeight = source === hockeyLifeLogo ? geometry.stageHeight : markSize + 44;
  const mastheadHeight = source === hockeyLifeLogo ? geometry.mastheadHeight : stageHeight + 18;

  const settle = React.useCallback(() => {
    animationToken.current += 1;
    const currentAnimation = animation.current;
    animation.current = null;
    currentAnimation?.stop();
    opacity.stopAnimation();
    rise.stopAnimation();
    scale.stopAnimation();
    sweep.stopAnimation();
    opacity.setValue(1);
    rise.setValue(0);
    scale.setValue(1);
    sweep.setValue(1);
  }, [opacity, rise, scale, sweep]);

  React.useEffect(() => {
    if (!isFocused || appState !== 'active' || imageStatus === 'pending') {
      settle();
      return;
    }
    if (animatedRequest.current === requestToken) {
      settle();
      return;
    }
    animatedRequest.current = requestToken;

    const token = animationToken.current + 1;
    animationToken.current = token;
    opacity.setValue(0);
    rise.setValue(reduceMotion ? 0 : 22);
    scale.setValue(reduceMotion ? 1 : 0.94);
    sweep.setValue(reduceMotion ? 1 : -1);
    const nextAnimation = reduceMotion
      ? Animated.timing(opacity, { toValue: 1, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: true })
      : Animated.sequence([
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(rise, { toValue: 0, duration: 760, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
          Animated.timing(sweep, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        ]),
      ]);
    animation.current = nextAnimation;
    nextAnimation.start(({ finished }) => {
      if (finished && animationToken.current === token && animation.current === nextAnimation) animation.current = null;
    });
    return () => {
      if (animationToken.current === token) settle();
    };
  }, [appState, imageStatus, isFocused, reduceMotion, requestToken, opacity, rise, scale, sweep, settle]);

  React.useEffect(() => {
    if (transparencyPreference.current !== reduceTransparency) settle();
    transparencyPreference.current = reduceTransparency;
  }, [reduceTransparency, settle]);

  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      setAppState(state);
    });
    return () => subscription.remove();
  }, []);

  const showImage = source !== null && imageStatus !== 'failed';
  const motionStyle = {
    opacity,
    transform: reduceMotion ? undefined : [{ translateY: rise }, { scale }],
    width: markSize,
    height: markSize,
  };
  const sweepTranslate = sweep.interpolate({ inputRange: [-1, 1], outputRange: [-markSize, markSize] });

  return (
    <View testID="home-league-hero" style={[styles.masthead, { height: mastheadHeight }]}>
      <View style={styles.action}>{updatesAction}</View>
      <View pointerEvents="none" style={[styles.stage, { width: stageWidth, height: stageHeight }]}>
        {!reduceTransparency ? (
          <View
            testID="home-league-hero-halo"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={[styles.atmosphere, { width: stageWidth, height: stageHeight }]}
          >
            <LinearGradient
              colors={[`${secondaryColor}00`, `${secondaryColor}0A`, `${primaryColor}12`, `${secondaryColor}0A`, `${primaryColor}00`]}
              locations={[0, 0.24, 0.5, 0.76, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.aura, { width: stageWidth - 8, height: stageHeight * 0.72, borderRadius: stageHeight }]}
            />
            <LinearGradient
              colors={[`${primaryColor}00`, `${primaryColor}12`, `${secondaryColor}0C`, `${primaryColor}00`]}
              locations={[0, 0.38, 0.62, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={[styles.aura, { width: markSize + 12, height: stageHeight * 0.4, borderRadius: stageHeight }]}
            />
          </View>
        ) : null}
        <Animated.View testID="home-league-hero-motion" style={[motionStyle, styles.motion]}>
          {showImage ? (
            <>
              {imageStatus === 'pending' ? (
                <View testID="home-league-hero-loading-fallback" accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.fallback, { width: markSize, height: markSize }]}>
                  <Text accessible={false} style={[styles.initials, { color: primaryColor, fontSize: markSize * 0.34 }]}>{initialsFor(leagueName)}</Text>
                  <Text accessible={false} numberOfLines={2} style={styles.leagueName}>{leagueName}</Text>
                </View>
              ) : null}
              <Image
                key={identityKey}
                testID="home-league-hero-image"
                accessible
                accessibilityRole="image"
                accessibilityLabel={`${leagueName} logo`}
                alt={`${leagueName} logo`}
                source={source}
                resizeMode="contain"
                style={[styles.image, { width: markSize, height: markSize }]}
                onLoad={handleImageLoad}
                onError={handleImageError}
              />
            </>
          ) : (
            <View testID="home-league-hero-fallback" accessible accessibilityRole="image" accessibilityLabel={`${leagueName} logo`} style={[styles.fallback, { width: markSize, height: markSize }]}>
              <Text accessible={false} style={[styles.initials, { color: primaryColor, fontSize: markSize * 0.34 }]}>{initialsFor(leagueName)}</Text>
              <Text accessible={false} numberOfLines={2} style={styles.leagueName}>{leagueName}</Text>
            </View>
          )}
        </Animated.View>
        {!reduceMotion && !reduceTransparency ? (
          <Animated.View
            testID="home-league-hero-sweep"
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
            style={[styles.sweep, { height: markSize * 1.3, transform: [{ translateX: sweepTranslate }, { rotate: '14deg' }] }]}
          >
            <LinearGradient colors={['transparent', 'rgba(255,255,255,0.20)', 'transparent']} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={StyleSheet.absoluteFillObject} />
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

export default function HomeLeagueHero(props: Props) {
  return <HomeLeagueHeroAnimated {...props} />;
}

const styles = StyleSheet.create({
  masthead: { position: 'relative', alignItems: 'center', justifyContent: 'flex-end' },
  action: { position: 'absolute', zIndex: 3, top: 0, right: 0, minHeight: 44, justifyContent: 'center' },
  stage: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  atmosphere: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  aura: { position: 'absolute' },
  motion: { alignItems: 'center', justifyContent: 'center' },
  image: { position: 'absolute' },
  fallback: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  initials: { fontWeight: '900', letterSpacing: 2 },
  leagueName: { color: '#F8FBFF', fontSize: 13, lineHeight: 17, fontWeight: '800', textAlign: 'center', marginTop: 2 },
  sweep: { position: 'absolute', width: 46, left: '50%', top: '-15%', opacity: 0.72 },
});
