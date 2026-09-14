import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import hockeyLifeLogo from '../../../assets/hockey-life-logo.png';
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
      <Image source={hockeyLifeLogo} style={styles.logo} alt="Hockey Life logo" accessibilityIgnoresInvertColors />
      <Text style={styles.title}>Hockey Life</Text>
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
  title: {
    fontSize: 38,
    fontWeight: '900',
    color: colors.primary,
    letterSpacing: -0.8,
  },
  kicker: {
    marginTop: 10,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
});
