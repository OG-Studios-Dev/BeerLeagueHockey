import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../../context/AuthContext';
import AuthShell from '../../components/AuthShell';
import colors from '../../theme/colors';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type FocusedField = 'fullName' | 'email' | 'password' | 'confirmPassword' | null;

export default function SignUpScreen() {
  const { signUpWithEmail } = useAuth();
  const navigation = useNavigation();
  const [fullName, setFullName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [focusedInput, setFocusedInput] = React.useState<FocusedField>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isSuccess, setIsSuccess] = React.useState(false);

  const clearError = () => {
    if (errorMessage) setErrorMessage(null);
  };

  const validate = (): string | null => {
    if (!fullName.trim()) return 'Please enter your full name';
    if (!email.trim()) return 'Please enter your email address';
    if (!EMAIL_REGEX.test(email.trim())) return 'Please enter a valid email address';
    if (!password) return 'Please enter a password';
    if (password.length < 8) return 'Password must be at least 8 characters';
    if (password !== confirmPassword) return 'Passwords do not match';
    return null;
  };

  const handleSignUp = async () => {
    const validationError = validate();
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setErrorMessage(null);
    setIsLoading(true);

    const { error } = await signUpWithEmail(email.trim(), password, fullName.trim());

    setIsLoading(false);

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('already registered') || msg.includes('already been registered')) {
        setErrorMessage('An account with this email already exists. Try signing in.');
      } else {
        setErrorMessage(error.message);
      }
    } else {
      setIsSuccess(true);
    }
  };

  return (
    <AuthShell title="Join the league" subtitle="Create your player account and get game-ready.">
          <Pressable accessibilityRole="button" accessibilityLabel="Back to sign in" style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
          </Pressable>

          {isSuccess ? (
            <View style={styles.successContainer}>
              <Ionicons name="checkmark-circle" size={48} color={colors.accentGreen} />
              <Text style={styles.successTitle}>Check your email</Text>
              <Text style={styles.successText}>
                We&apos;ve sent a verification link to {email.trim()}. Please verify your email to
                complete registration.
              </Text>
              <Pressable style={styles.backToLoginButton} onPress={() => navigation.goBack()}>
                <Text style={styles.backToLoginText}>Back to Sign In</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <TextInput
                autoCapitalize="words"
                placeholder="Full Name"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, focusedInput === 'fullName' ? styles.inputFocused : undefined]}
                value={fullName}
                onChangeText={(t) => { setFullName(t); clearError(); }}
                onFocus={() => setFocusedInput('fullName')}
                onBlur={() => setFocusedInput(null)}
              />

              <TextInput
                autoCapitalize="none"
                keyboardType="email-address"
                placeholder="Email"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, focusedInput === 'email' ? styles.inputFocused : undefined]}
                value={email}
                onChangeText={(t) => { setEmail(t); clearError(); }}
                onFocus={() => setFocusedInput('email')}
                onBlur={() => setFocusedInput(null)}
              />

              <TextInput
                autoCapitalize="none"
                placeholder="Password"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, focusedInput === 'password' ? styles.inputFocused : undefined]}
                value={password}
                onChangeText={(t) => { setPassword(t); clearError(); }}
                secureTextEntry
                onFocus={() => setFocusedInput('password')}
                onBlur={() => setFocusedInput(null)}
              />

              <TextInput
                autoCapitalize="none"
                placeholder="Confirm Password"
                placeholderTextColor={colors.textSecondary}
                style={[styles.input, focusedInput === 'confirmPassword' ? styles.inputFocused : undefined]}
                value={confirmPassword}
                onChangeText={(t) => { setConfirmPassword(t); clearError(); }}
                secureTextEntry
                onFocus={() => setFocusedInput('confirmPassword')}
                onBlur={() => setFocusedInput(null)}
              />

              {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

              <Pressable
                style={styles.signUpButton}
                onPress={handleSignUp}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={styles.signUpButtonText}>Create Account</Text>
                )}
              </Pressable>

              <Pressable style={styles.signInLink} onPress={() => navigation.goBack()}>
                <Text style={styles.signInLinkText}>
                  Already have an account? <Text style={styles.signInLinkBold}>Sign In</Text>
                </Text>
              </Pressable>
            </>
          )}
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    marginBottom: 12,
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
  errorText: {
    marginBottom: 12,
    color: colors.accentRed,
    fontSize: 13,
    fontWeight: '600',
  },
  signUpButton: {
    marginTop: 4,
    width: '100%',
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    paddingVertical: 14,
  },
  signUpButtonText: {
    color: colors.textOnPrimary,
    fontWeight: '800',
    fontSize: 16,
  },
  signInLink: {
    marginTop: 16,
    alignItems: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  signInLinkText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  signInLinkBold: {
    color: colors.textInteractive,
    fontWeight: '700',
  },
  successContainer: {
    alignItems: 'center',
    paddingTop: 24,
    gap: 12,
  },
  successTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
  },
  successText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    paddingHorizontal: 8,
  },
  backToLoginButton: {
    marginTop: 16,
    minHeight: 48,
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderCard,
  },
  backToLoginText: {
    color: colors.textInteractive,
    fontWeight: '700',
    fontSize: 15,
  },
});
