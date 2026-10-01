import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { BLH_DEFAULT_PLAYER_AVATAR_URL } from '../../lib/imagePlaceholders';
import colors from '../../theme/colors';

export default function PlayerPortrait({ uri, name, accent }: { uri: string | null; name: string; accent: string }) {
  const [source, setSource] = React.useState(uri ?? BLH_DEFAULT_PLAYER_AVATAR_URL);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { setSource(uri ?? BLH_DEFAULT_PLAYER_AVATAR_URL); setFailed(false); }, [uri]);
  const initials = name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
  if (failed) return <View accessibilityLabel={`${name} photo unavailable`} style={[styles.frame, styles.fallback, { borderColor: accent }]}><Text style={styles.initials}>{initials}</Text></View>;
  return <Image alt={`${name} photo`} accessibilityLabel={`${name} photo`} source={{ uri: source }} resizeMode="cover" style={[styles.frame, { borderColor: accent }]} onError={() => source === BLH_DEFAULT_PLAYER_AVATAR_URL ? setFailed(true) : setSource(BLH_DEFAULT_PLAYER_AVATAR_URL)} />;
}

const styles = StyleSheet.create({
  frame: { width: 200, height: 200, maxWidth: '100%', borderRadius: 16, borderWidth: 2, backgroundColor: colors.bgInteractive },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.textPrimary, fontSize: 58, fontWeight: '900' },
});
