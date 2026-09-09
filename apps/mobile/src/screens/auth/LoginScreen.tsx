import React from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import AuthShell from '../../components/AuthShell';
import { useAuth } from '../../context/AuthContext';
import colors from '../../theme/colors';

type AuthStackParamList = {
  Splash: undefined;
  Login: undefined;
  ForgotPassword: undefined;
  SignUp: undefined;
};

type LoginAction = 'apple' | 'google' | 'email' | null;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GOOGLE_SVG = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`;

const APPLE_SVG = `<svg viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>`;

const GOOGLE_ICON_URI = `data:image/svg+xml;utf8,${encodeURIComponent(GOOGLE_SVG)}`;
const APPLE_ICON_URI = `data:image/svg+xml;utf8,${encodeURIComponent(APPLE_SVG)}`;

function getEmailErrorMessage(supabaseMessage: string): string {
  const msg = supabaseMessage.toLowerCase();
  if (msg.includes('invalid login credentials')) {
    return 'Invalid email or password';
  }
  if (msg.includes('email not confirmed')) {
    return 'Please verify your email before signing in';
  }
  if (msg.includes('user not found') || msg.includes('no user found')) {
    return 'Account not found. Check your email or sign up.';
  }
  if (msg.includes('too many requests') || msg.includes('rate limit')) {
    return 'Too many attempts. Please try again later.';
  }
  return supabaseMessage;
}

export default function LoginScreen() {
  const { signInWithApple, signInWithEmail, signInWithGoogle, continueAsGuest } = useAuth();
  const navigation = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [focusedInput, setFocusedInput] = React.useState<'email' | 'password' | null>(null);
  const [loadingAction, setLoadingAction] = React.useState<LoginAction>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  const clearError = () => {
    if (errorMessage) setErrorMessage(null);
  };

  const handleEmailChange = (text: string) => {
    setEmail(text);
    clearError();
  };

  const handlePasswordChange = (text: string) => {
    setPassword(text);
    clearError();
  };

  const validateInputs = (): string | null => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) return 'Please enter your email address';
    if (!EMAIL_REGEX.test(trimmedEmail)) return 'Please enter a valid email address';
    if (!password) return 'Please enter your password';
    return null;
  };

  const handleEmailSignIn = async () => {
    const validationError = validateInputs();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setErrorMessage(null);
    setLoadingAction('email');
    const { error } = await signInWithEmail(email.trim(), password);
    setLoadingAction(null);

    if (error) {
      setErrorMessage(getEmailErrorMessage(error.message));
    }
  };

  const handleAppleSignIn = async () => {
    setErrorMessage(null);
    setLoadingAction('apple');
    const { error } = await signInWithApple();
    setLoadingAction(null);

    if (error) {
      setErrorMessage(error.message);
    }
  };

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setLoadingAction('google');
    const { error } = await signInWithGoogle();
    setLoadingAction(null);

    if (error) {
      setErrorMessage(error.message);
    }
  };

  const handleGuestMode = () => {
    continueAsGuest();
  };

  return (
    <AuthShell title="Welcome back" subtitle="Your next game, team, and league are waiting.">

          {Platform.OS === 'ios' ? (
            <Pressable
              style={[styles.oauthButton, styles.appleButton]}
              onPress={handleAppleSignIn}
              disabled={loadingAction !== null}
            >
              {loadingAction === 'apple' ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Image source={{ uri: APPLE_ICON_URI }} style={styles.oauthIcon} />
                  <Text style={[styles.oauthButtonText, styles.appleButtonText]}>Continue with Apple</Text>
                </>
              )}
            </Pressable>
          ) : null}

          <Pressable
            style={[styles.oauthButton, styles.googleButton]}
            onPress={handleGoogleSignIn}
            disabled={loadingAction !== null}
          >
            {loadingAction === 'google' ? (
              <ActivityIndicator color="#111827" />
            ) : (
              <>
                <Image source={{ uri: GOOGLE_ICON_URI }} style={styles.oauthIcon} />
                <Text style={[styles.oauthButtonText, styles.googleButtonText]}>Continue with Google</Text>
              </>
            )}
          </Pressable>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TextInput
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="Email"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, focusedInput === 'email' ? styles.inputFocused : undefined]}
            value={email}
            onChangeText={handleEmailChange}
            onFocus={() => setFocusedInput('email')}
            onBlur={() => setFocusedInput(null)}
          />

          <TextInput
            autoCapitalize="none"
            placeholder="Password"
            placeholderTextColor={colors.textSecondary}
            style={[styles.input, focusedInput === 'password' ? styles.inputFocused : undefined]}
            value={password}
            onChangeText={handlePasswordChange}
            secureTextEntry
            onFocus={() => setFocusedInput('password')}
            onBlur={() => setFocusedInput(null)}
          />

          <Pressable
            style={styles.forgotPasswordButton}
            onPress={() => navigation.navigate('ForgotPassword')}
          >
            <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
          </Pressable>

          <Pressable
            style={styles.signInButton}
            onPress={handleEmailSignIn}
            disabled={loadingAction !== null}
          >
            {loadingAction === 'email' ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.signInButtonText}>Sign In</Text>
            )}
          </Pressable>

          {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

          <Pressable style={styles.signUpLink} onPress={() => navigation.navigate('SignUp')}>
            <Text style={styles.signUpLinkText}>
              Don&apos;t have an account? <Text style={styles.signUpLinkBold}>Sign Up</Text>
            </Text>
          </Pressable>

          <Pressable style={styles.guestButton} onPress={handleGuestMode}>
            <Text style={styles.guestText}>Continue as Guest</Text>
          </Pressable>

          <View style={styles.legalLinks}>
            <Pressable onPress={() => Linking.openURL('https://beerleaguehockey.ca/privacy')}>
              <Text style={styles.legalText}>Privacy Policy</Text>
            </Pressable>
            <Text style={styles.legalSeparator}>|</Text>
            <Pressable onPress={() => Linking.openURL('https://beerleaguehockey.ca/terms')}>
              <Text style={styles.legalText}>Terms of Service</Text>
            </Pressable>
          </View>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  oauthButton: {
    width: '100%',
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 14,
  },
  oauthButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  oauthIcon: {
    width: 20,
    height: 20,
  },
  appleButton: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  appleButtonText: {
    color: '#FFFFFF',
  },
  googleButton: {
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  googleButtonText: {
    color: '#000000',
  },
  dividerRow: {
    marginVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderCard,
  },
  dividerText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'lowercase',
  },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderCard,
    backgroundColor: colors.bgSurface,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  inputFocused: {
    borderColor: colors.primary,
  },
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
    marginBottom: 12,
    marginTop: -4,
  },
  forgotPasswordText: {
    color: colors.textInteractive,
    fontSize: 13,
    fontWeight: '600',
  },
  signInButton: {
    marginTop: 4,
    width: '100%',
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    paddingVertical: 14,
  },
  signInButtonText: {
    color: colors.textOnPrimary,
    fontWeight: '800',
    fontSize: 16,
  },
  errorText: {
    marginTop: 12,
    color: colors.accentRed,
    fontSize: 13,
    textAlign: 'center',
    fontWeight: '600',
  },
  signUpLink: {
    marginTop: 16,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  signUpLinkText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  signUpLinkBold: {
    color: colors.textInteractive,
    fontWeight: '700',
  },
  guestButton: {
    marginTop: 8,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  guestText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  legalLinks: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
    gap: 8,
  },
  legalText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  legalSeparator: {
    color: colors.textSecondary,
    fontSize: 12,
  },
});
