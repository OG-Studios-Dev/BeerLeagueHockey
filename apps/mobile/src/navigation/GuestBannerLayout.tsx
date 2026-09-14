import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AuthGuestBanner from '../components/AuthGuestBanner';

export default function GuestBannerLayout({ isGuest, children }: { isGuest: boolean; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [bannerHeight, setBannerHeight] = React.useState(0);

  return (
    <View style={styles.root}>
      {isGuest ? (
        <View
          testID="guest-banner-host"
          style={[styles.banner, { top: insets.top }]}
          onLayout={(event) => setBannerHeight(event.nativeEvent.layout.height)}
        >
          <AuthGuestBanner />
        </View>
      ) : null}
      <View testID="main-tab-container" style={[styles.content, isGuest && bannerHeight > 0 ? { paddingTop: bannerHeight } : null]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  banner: { position: 'absolute', left: 0, right: 0, zIndex: 10 },
  content: { flex: 1 },
});
