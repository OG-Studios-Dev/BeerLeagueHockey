import React from 'react';
import { Image, type ImageSourcePropType, StyleSheet, Text, View } from 'react-native';

import { BLH_DEFAULT_TEAM_LOGO_URL } from '../lib/imagePlaceholders';
import { getBundledTeamLogoSource } from '../lib/teamLogoSources';

type Props = {
  logoUrl: string | null;
  teamId?: string | null;
  teamName: string;
  primaryColor?: string | null;
  size?: number;
};

function resolveInitialSource(teamId?: string | null, logoUrl?: string | null): ImageSourcePropType {
  return getBundledTeamLogoSource(teamId, logoUrl) ?? { uri: logoUrl ?? BLH_DEFAULT_TEAM_LOGO_URL };
}

type LogoFallbackState = {
  identityKey: string;
  imageSource: ImageSourcePropType;
  usingDefault: boolean;
  showInitialsFallback: boolean;
};

function resolveInitialState(teamId?: string | null, logoUrl?: string | null): LogoFallbackState {
  const imageSource = resolveInitialSource(teamId, logoUrl);
  return {
    identityKey: JSON.stringify([teamId ?? null, logoUrl ?? null]),
    imageSource,
    usingDefault: typeof imageSource === 'object' && imageSource !== null
      && 'uri' in imageSource && imageSource.uri === BLH_DEFAULT_TEAM_LOGO_URL,
    showInitialsFallback: false,
  };
}

export default function TeamLogo({ logoUrl, teamId, teamName, primaryColor, size = 40 }: Props) {
  const initialState = React.useMemo(() => resolveInitialState(teamId, logoUrl), [teamId, logoUrl]);
  const [fallback, setFallback] = React.useState<LogoFallbackState>(initialState);
  const current = fallback.identityKey === initialState.identityKey ? fallback : initialState;

  React.useEffect(() => {
    setFallback(initialState);
  }, [initialState]);

  const initials = teamName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
  const imageFrameStyle = { width: size, height: size };
  const circleStyle = { ...imageFrameStyle, borderRadius: size / 2 };
  const bgColor = primaryColor ?? '#22D3EE';

  if (!current.showInitialsFallback) {
    return (
      <Image
        alt={teamName}
        accessibilityLabel={teamName}
        source={current.imageSource}
        style={[imageFrameStyle, styles.image]}
        onError={() => {
          if (!current.usingDefault) {
            setFallback({
              ...current,
              imageSource: { uri: BLH_DEFAULT_TEAM_LOGO_URL },
              usingDefault: true,
            });
            return;
          }

          setFallback({ ...current, showInitialsFallback: true });
        }}
      />
    );
  }

  return (
    <View style={[circleStyle, styles.fallback, { backgroundColor: bgColor }]}>
      <Text style={[styles.initials, { fontSize: size * 0.35 }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    resizeMode: 'contain',
  },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: '#000000', fontWeight: '800' },
});
