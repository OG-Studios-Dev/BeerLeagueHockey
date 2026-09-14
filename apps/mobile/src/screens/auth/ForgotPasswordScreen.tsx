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

import { supabase } from '../../lib/supabase/client';
import AuthShell from '../../components/AuthShell';
import colors from '../../theme/colors';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const navigation = useNavigation();
  const [email, setEmail] = React.useState('');
  const [focusedInput, setFocusedInput] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isSuccess, setIsSuccess] = React.useState(false);

  const handleEmailChange = (text: string) => {
    setEmail(text);
    if (errorMessage) setErrorMessage(null);
  };

  const handleResetPassword = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setErrorMessage('Please enter your email address');
      return;
    }
    if (!EMAIL_REGEX.test(trimmed)) {
      setErrorMessage('Please enter a valid email address');
      return;
    }

    setErrorMessage(null);
    setIsLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(trimmed, {
      redirectTo: 'blh://auth/reset-callback',
    });

    setIsLoading(false);

    if (error) {
      setErrorMessage(error.message);
    } else {
      setIsSuccess(true);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your email and we’ll send a secure reset link."
    >
        {isSuccess ? (
          <View style={styles.successContainer}>
            <Ionicons name="checkmark-circle" size={48} color={colors.accentGreen} />
            <Text style={styles.successTitle}>Check your email</Text>
            <Text style={styles.successText}>
              We&apos;ve sent a password reset link to {email.trim()}. Check your inbox and follow the
              instructions.
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Back to sign in" style={styles.backToLoginButton} onPress={() => navigation.goBack()}>
              <Text style={styles.backToLoginText}>Back to Sign In</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <TextInput
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="Email"
              placeholderTextColor={colors.textSecondary}
              style={[styles.input, focusedInput ? styles.inputFocused : undefined]}
              value={email}
              onChangeText={handleEmailChange}
              onFocus={() => setFocusedInput(true)}
              onBlur={() => setFocusedInput(false)}
            />

            {errorMessage ? <Text style={styles.errorText}>{errorMessage}</Text> : null}

            <Pressable
              style={styles.submitButton}
              onPress={handleResetPassword}
              disabled={isLoading}
            >
              {isLoading ? (
                <ActivityIndicator color={colors.textOnPrimary} />
              ) : (
                <Text style={styles.submitButtonText}>Send Reset Link</Text>
              )}
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel password reset" style={styles.cancelButton} onPress={() => navigation.goBack()}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>
          </>
        )}
    </AuthShell>
  );
}

const styles = StyleSheet.create({
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
  submitButton: {
    marginTop: 4,
    width: '100%',
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    paddingVertical: 14,
  },
  submitButtonText: {
    color: colors.textOnPrimary,
    fontWeight: '800',
    fontSize: 16,
  },
  cancelButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  cancelButtonText: { color: colors.textInteractive, fontSize: 15, fontWeight: '700' },
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
