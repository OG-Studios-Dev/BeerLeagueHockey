import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AccessibilityPreferencesProvider } from './src/context/AccessibilityPreferencesContext';
import { LeagueProvider } from './src/context/LeagueContext';
import RootNavigation from './src/navigation';
import LeagueSelectScreen from './src/screens/auth/LeagueSelectScreen';
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
type AppStackParamList = { Main: undefined; LeagueSelect: undefined; };

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const AppStack = createNativeStackNavigator<AppStackParamList>();

function AppContent() {
  const { session, isLoading, isGuest } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#22D3EE" size="large" />
      </View>
    );
  }

  if (session || isGuest) {
    return (
      <AppStack.Navigator screenOptions={{ headerShown: false }}>
        <AppStack.Screen name="Main" component={RootNavigation} />
        <AppStack.Screen
          name="LeagueSelect"
          component={LeagueSelectScreen}
          options={{ presentation: "modal", headerShown: false }}
        />
      </AppStack.Navigator>
    );
  }

  return (
    <AuthStack.Navigator initialRouteName="Splash" screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Splash" component={SplashScreen} />
      <AuthStack.Screen name="Login" component={LoginScreen} />
      <AuthStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <AuthStack.Screen name="SignUp" component={SignUpScreen} />
    </AuthStack.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AccessibilityPreferencesProvider>
        <AuthProvider>
          <LeagueProvider>
            <NavigationContainer>
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A0F1E',
  },
});
