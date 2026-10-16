import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';

import type { ProfileStackParamList } from '../navigation/types';
import { PolicyBullet, PolicyPage, PolicyParagraph, PolicySection } from './PolicyPageCommon';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Privacy'>;

export default function PrivacyScreen({ navigation }: Props) {
  return (
    <PolicyPage
      eyebrow="Hockey Life app policy"
      navigation={navigation}
      summary="This policy explains, in plain language, what information the Hockey Life app handles and the choices available to you."
      title="Privacy"
      updated="Last updated: October 16, 2026"
    >
      <PolicySection focusId="privacy:collect" title="Information we collect">
        <PolicyBullet>Account and profile information, such as your name, email address, profile details, and account identifiers.</PolicyBullet>
        <PolicyBullet>Roster, league, game participation, and statistics connected to your Hockey Life activity.</PolicyBullet>
        <PolicyBullet>Your availability, attendance, and app interactions, including responses and actions you take in the app.</PolicyBullet>
        <PolicyBullet>Support submissions and the information you choose to include when asking for help.</PolicyBullet>
        <PolicyBullet>An optional push token and notification preferences when you choose to enable notifications.</PolicyBullet>
        <PolicyBullet>Necessary technical and security data, such as device and app information, request records, and diagnostics used to operate and protect the service.</PolicyBullet>
        <PolicyBullet>Signed waivers, including the minimum information needed to show what was accepted and when.</PolicyBullet>
        <PolicyBullet>Payment, audit, and tax records, such as amounts, currency, status, and dates. Stripe processes payment-card details; Hockey Life does not collect or retain full payment-card numbers.</PolicyBullet>
      </PolicySection>

      <PolicySection focusId="privacy:use" title="How we use information">
        <PolicyParagraph>
          We use information to create and maintain accounts, show the right league and team experience, operate rosters and game records, record availability and attendance, deliver requested notifications, answer support requests, troubleshoot problems, prevent misuse, and improve Hockey Life.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="privacy:share" title="When we share information">
        <PolicyParagraph>
          Information relevant to a league may be visible to league organizers, team leaders, teammates, participants, or the public according to the league feature and the organizer’s settings. League organizers may use that information to administer their leagues.
        </PolicyParagraph>
        <PolicyParagraph>
          We may share information with service providers that help host, deliver, support, monitor, or secure Hockey Life. They receive only the information reasonably needed to provide those services. We may also disclose information when required by law or when reasonably necessary to protect users, the service, or others.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="privacy:sale" title="No sale of personal data">
        <PolicyParagraph>We do not sell your personal data.</PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="privacy:retention" title="Retention">
        <PolicyParagraph>
          We keep information for as long as it is reasonably needed to provide Hockey Life, maintain league and game records, meet legal or operational obligations, resolve disputes, and protect the service. Retention can differ by information type and league context. We delete or de-identify information when it is no longer reasonably needed, subject to legitimate recordkeeping needs.
        </PolicyParagraph>
        <PolicyParagraph>
          After account deletion, signed waivers retain their minimum evidentiary fields and are not anonymous. Minimum payment, audit, and tax facts retain legal identifiers and are not anonymous. Hockey Life clears Stripe handles, metadata, idempotency material, reminders, and free text from those retained payment records.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="privacy:security" title="Security">
        <PolicyParagraph>
          We use reasonable administrative and technical safeguards appropriate to the service. No storage or transmission method is completely secure, so we cannot promise absolute security. Protect your sign-in information and contact support if you believe your account has been misused.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="privacy:choices" title="Your choices and requests">
        <PolicyParagraph>
          You can update available profile details in the app. You may ask to access, correct, or delete personal information by emailing support@beerleaguehockey.ca. We may need to verify your request, and some league, safety, legal, or operational records may need to be retained.
        </PolicyParagraph>
        <PolicyParagraph>
          Push notifications are optional. You can change notification preferences in Hockey Life or your device settings. Turning them off does not prevent you from using the rest of the app.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="privacy:children" title="Children">
        <PolicyParagraph>
          Hockey Life is not directed to children under 13. If you believe a child under 13 has provided personal information through the app, contact us so we can review the situation.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="privacy:updates" title="Policy updates">
        <PolicyParagraph>
          We may update this policy as Hockey Life or applicable requirements change. We will update the date shown here and provide additional notice in the app when an update is material and notice is appropriate.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="privacy:contact" title="Contact">
        <PolicyParagraph>Questions or privacy requests can be sent to support@beerleaguehockey.ca.</PolicyParagraph>
      </PolicySection>
    </PolicyPage>
  );
}