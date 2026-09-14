import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

type Props = {
  logoUrl: string | null;
  leagueName: string;
  primaryColor?: string | null;
  size?: number;
};

function initialsFor(name: string) {
  return name.trim().split(/\s+/).filter(Boolean).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || 'BL';
}

export default function LeagueLogo({ logoUrl, leagueName, primaryColor, size = 40 }: Props) {
  const identityKey = logoUrl ?? '';
  const [failedIdentityKey, setFailedIdentityKey] = React.useState<string | null>(null);
  const frame = { width: size, height: size, borderRadius: size / 2 };
  const accent = primaryColor ?? '#22D3EE';

  if (logoUrl && failedIdentityKey !== identityKey) {
    return (
      <Image
        alt={leagueName}
        accessibilityLabel={`${leagueName} logo`}
        source={{ uri: logoUrl }}
        resizeMode="contain"
        style={[frame, styles.image]}
        onError={() => setFailedIdentityKey(identityKey)}
      />
    );
  }

  return (
    <View
      accessibilityLabel={`${leagueName} logo`}
      style={[frame, styles.fallback, { backgroundColor: `${accent}22`, borderColor: accent }]}
    >
      <Text style={[styles.initials, { color: accent, fontSize: size * 0.34 }]}>{initialsFor(leagueName)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { backgroundColor: 'transparent' },
  fallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5 },
  initials: { fontWeight: '900' },
});
