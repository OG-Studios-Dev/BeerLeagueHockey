import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import blhLogo from '../../../assets/blh-logo.png';
import BrandAtmosphere from '../../components/BrandAtmosphere';
import colors from '../../theme/colors';

export default function SplashScreen({ navigation }: { navigation: any }) {
  React.useEffect(() => {
    const timer = setTimeout(() => {
      navigation.replace('Login');
    }, 1500);

    return () => clearTimeout(timer);
  }, [navigation]);

  return (
    <View style={styles.container}>
      <BrandAtmosphere intensity="high" />
      <Text style={styles.eyebrow}>BEER LEAGUE HOCKEY</Text>
      <Image source={blhLogo} style={styles.logo} accessibilityIgnoresInvertColors />
      <Text style={styles.title}>BLH</Text>
      <Text style={styles.subtitle}>Beer League Hockey</Text>
      <Text style={styles.kicker}>Built for the bench.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: 120,
    height: 120,
    marginBottom: 12,
  },
  eyebrow: {
    color: colors.textInteractive,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2.2,
    marginBottom: 18,
  },
  title: {
    fontSize: 44,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: 1,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  kicker: {
    marginTop: 10,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
});
