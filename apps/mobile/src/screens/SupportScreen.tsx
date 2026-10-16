import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';

import type { ProfileStackParamList } from '../navigation/types';
import {
  PolicyBullet,
  PolicyPage,
  PolicyParagraph,
  PolicySection,
  policyPageStyles,
} from './PolicyPageCommon';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Support'>;

export const SUPPORT_EMAIL = 'support@beerleaguehockey.ca';
export const SUPPORT_MAILTO_URL = 'mailto:support@beerleaguehockey.ca?subject=Hockey%20Life%20App%20Support';

export default function SupportScreen({ navigation }: Props) {
  const [emailError, setEmailError] = React.useState<string | null>(null);

  const openSupportEmail = async () => {
    setEmailError(null);
    try {
      await Linking.openURL(SUPPORT_MAILTO_URL);
    } catch {
      setEmailError(`We could not open your email app. You can still email us directly at ${SUPPORT_EMAIL}.`);
    }
  };

  return (
    <PolicyPage
      eyebrow="Help with Hockey Life"
      navigation={navigation}
      summary="Get help with the Hockey Life mobile app while keeping league questions with the people who run your league."
      title="Support"
    >
      <PolicySection focusId="support:app" title="App and technical support">
        <PolicyParagraph>
          Email us when Hockey Life will not open, a screen is not working, notifications are behaving unexpectedly, or you need help using an app feature.
        </PolicyParagraph>
        <PolicyParagraph>
          We typically reply within 24–48 hours. This is a typical response window, not a guarantee, and complex issues can take longer.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="support:league" title="League-specific questions">
        <PolicyParagraph>
          League organizers handle questions about registration, rosters, eligibility, schedules, discipline, standings, and league rules.
        </PolicyParagraph>
        <PolicyParagraph>
          For league-specific questions, open More → Contact to use the contact information published by your league.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="support:context" title="What to include">
        <PolicyParagraph>Useful context helps us understand the issue without asking you to repeat the basics.</PolicyParagraph>
        <PolicyBullet>Your device model and operating system version.</PolicyBullet>
        <PolicyBullet>Your Hockey Life app version.</PolicyBullet>
        <PolicyBullet>What you were doing, what you expected, and what happened instead.</PolicyBullet>
        <PolicyBullet>Any error message you saw and when the problem occurred.</PolicyBullet>
        <PolicyParagraph>
          Never send us passwords or payment-card information. If a screenshot contains private details, cover or remove them before attaching it.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="support:email" title="Email support">
        <PolicyParagraph>Write to {SUPPORT_EMAIL}. The button below starts a new message with a useful subject.</PolicyParagraph>
        {emailError ? (
          <View accessibilityRole="alert" style={policyPageStyles.error}>
            <Text style={policyPageStyles.errorText}>{emailError}</Text>
          </View>
        ) : null}
        <Pressable
          accessibilityHint="Opens your email app with a Hockey Life App Support subject"
          accessibilityLabel="Email Hockey Life Support"
          accessibilityRole="button"
          onPress={() => { void openSupportEmail(); }}
          style={policyPageStyles.action}
        >
          <Text style={policyPageStyles.actionText}>Email Support</Text>
        </Pressable>
      </PolicySection>
    </PolicyPage>
  );
}