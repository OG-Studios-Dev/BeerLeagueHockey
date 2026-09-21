import { DarkTheme, NavigationContainer, type Theme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AccessibilityPreferencesProvider } from './src/context/AccessibilityPreferencesContext';
import MembershipDiagnosticsCard from './src/components/MembershipDiagnosticsCard';
import CutIceTitle from './src/components/CutIceTitle';
import { cutIceScreenLayout } from './src/navigation/CutIceScreenBoundary';
import { LeagueProvider, useLeague } from './src/context/LeagueContext';
import RootNavigation from './src/navigation';
import LoginScreen from './src/screens/auth/LoginScreen';
import ForgotPasswordScreen from './src/screens/auth/ForgotPasswordScreen';
import SignUpScreen from './src/screens/auth/SignUpScreen';
import SplashScreen from './src/screens/auth/SplashScreen';

type AuthStackParamList = {
  Splash: undefined;
  Login: undefined;
  ForgotPassword: undefined;
  SignUp: undefined;
};
type AppStackParamList = { Main: undefined };

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

function authCutIceOptions(title: string) {
  return {
    headerShown: true,
    header: ({ navigation, back }: { navigation: { goBack: () => void }; back?: unknown }) => (
      <CutIceTitle title={title} onBack={back ? navigation.goBack : undefined} />
    ),
  };
}

export const APP_NAVIGATION_THEME: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: '#22D3EE',
    background: '#07111F',
    card: '#0A1628',
    text: '#F7FBFF',
    border: 'rgba(255, 255, 255, 0.12)',
    notification: '#EF4444',
  },
};

function AppContent() {
  const { session, isLoading, isGuest } = useAuth();
  const { membershipDiagnostics, membershipStatus, retryMemberships } = useLeague();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#22D3EE" size="large" />
      </View>
    );
  }

  if (session || isGuest) {
    return (
      <AppStack.Navigator screenOptions={{ headerShown: false, contentStyle: styles.navigationCanvas }}>
        <AppStack.Screen name="Main" component={RootNavigation} />
      </AppStack.Navigator>
    );
  }

  return (
    <View style={styles.authShell}>
      <View style={styles.authNavigation}>
        <AuthStack.Navigator initialRouteName="Splash" screenOptions={{ contentStyle: styles.navigationCanvas }} screenLayout={cutIceScreenLayout}>
          <AuthStack.Screen name="Splash" component={SplashScreen} options={authCutIceOptions('Hockey Life')} />
          <AuthStack.Screen name="Login" component={LoginScreen} options={authCutIceOptions('Sign In')} />
          <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={authCutIceOptions('Reset Password')} />
          <AuthStack.Screen name="SignUp" component={SignUpScreen} options={authCutIceOptions('Create Account')} />
        </AuthStack.Navigator>
      </View>
      {membershipStatus === 'error' || membershipStatus === 'incomplete' ? (
        <MembershipDiagnosticsCard
          diagnostics={membershipDiagnostics}
          status={membershipStatus}
          onRetry={retryMemberships}
          initiallyExpanded
        />
      ) : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider style={styles.appRoot}>
      <AccessibilityPreferencesProvider>
        <AuthProvider>
          <LeagueProvider>
            <NavigationContainer theme={APP_NAVIGATION_THEME}>
              <StatusBar style="light" />
              <AppContent />
            </NavigationContainer>
          </LeagueProvider>
        </AuthProvider>
      </AccessibilityPreferencesProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  appRoot: {
    flex: 1,
    backgroundColor: '#07111F',
  },
  navigationCanvas: {
    backgroundColor: '#07111F',
  },
  authShell: {
    flex: 1,
    backgroundColor: '#0A0F1E',
  },
  authNavigation: { flex: 1 },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A0F1E',
  },
});
