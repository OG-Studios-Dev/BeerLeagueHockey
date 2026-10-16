import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';

import type { ProfileStackParamList } from '../navigation/types';
import { PolicyBullet, PolicyPage, PolicyParagraph, PolicySection } from './PolicyPageCommon';

type Props = NativeStackScreenProps<ProfileStackParamList, 'Terms'>;

export default function TermsScreen({ navigation }: Props) {
  return (
    <PolicyPage
      eyebrow="Hockey Life app terms"
      navigation={navigation}
      summary="These terms set practical expectations for using the Hockey Life mobile app and participating in leagues that use it."
      title="Terms"
      updated="Last updated: October 16, 2026"
    >
      <PolicySection focusId="terms:acceptance" title="Acceptance">
        <PolicyParagraph>
          By creating an account or using Hockey Life, you agree to these terms. If you do not agree, do not use the app. A league may have additional organizer rules for participation; those rules apply alongside these app terms.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="terms:account" title="Account accuracy and security">
        <PolicyParagraph>
          Provide accurate, current information and keep it updated. Keep your sign-in details private, do not share access to your account, and tell support promptly if you believe someone else has used it. You are responsible for activity performed through your account to the extent permitted by law.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="terms:participation" title="League participation and conduct">
        <PolicyParagraph>
          Follow applicable organizer rules, team expectations, rink policies, and reasonable instructions from league officials. Treat players, organizers, officials, and other users respectfully. Hockey Life supports league operations but does not replace decisions made by league organizers about eligibility, rosters, discipline, or competition.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="terms:records" title="Availability, schedules, and stats">
        <PolicyParagraph>
          Availability responses, attendance, schedules, scores, standings, and stats are operational records used to run league activities. They may change because of organizer corrections, game changes, delayed reporting, data review, or technical issues. Check with your league when a record affects participation or another time-sensitive decision.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="terms:content" title="Your submissions and content">
        <PolicyParagraph>
          You keep ownership of content you submit. You give Hockey Life and the relevant league organizers a non-exclusive permission to host, copy, display, and use that content only as reasonably needed for operating and promoting Hockey Life and league services. You confirm that you have the right to submit the content and that using it this way does not violate another person’s rights.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="terms:prohibited" title="Prohibited conduct">
        <PolicyParagraph>Do not misuse Hockey Life. In particular, do not:</PolicyParagraph>
        <PolicyBullet>Access another person’s account or data without permission.</PolicyBullet>
        <PolicyBullet>Harass, threaten, impersonate, or deceive another person.</PolicyBullet>
        <PolicyBullet>Submit unlawful, infringing, malicious, or deliberately false content.</PolicyBullet>
        <PolicyBullet>Probe, disrupt, overload, scrape, reverse engineer, or bypass security or access controls except where applicable law expressly permits it.</PolicyBullet>
        <PolicyBullet>Use the app in a way that interferes with league operations or another person’s use of the service.</PolicyBullet>
      </PolicySection>

      <PolicySection focusId="terms:third-party" title="Third-party, device, and network services">
        <PolicyParagraph>
          Hockey Life depends on your device, operating system, app store, network connection, notification services, and other service providers. Their terms and availability may affect app features. We are not responsible for third-party services that we do not control.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="terms:suspension" title="Suspension and termination">
        <PolicyParagraph>
          Access may be limited, suspended, or ended when reasonably necessary to address misuse, security concerns, legal requirements, material violations of these terms, or league access changes. You may stop using the app at any time and can contact support about account deletion, subject to records that must reasonably be retained.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="terms:changes" title="Service changes and availability">
        <PolicyParagraph>
          We may add, change, limit, or remove app features and may perform maintenance. We work to keep Hockey Life useful and available, but we cannot promise that every feature will always be available, uninterrupted, or error-free.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="terms:limits" title="Disclaimers and limits">
        <PolicyParagraph>
          Hockey Life is provided on an “as available” basis. To the extent permitted by law, we are not responsible for indirect, incidental, or consequential losses resulting from use of the app or from records supplied by users or league organizers. These terms do not exclude consumer rights or any responsibility that cannot lawfully be excluded or limited.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="terms:updates" title="Updates to these terms">
        <PolicyParagraph>
          We may update these terms as the app or applicable requirements change. We will update the date shown here and provide additional notice in the app when a change is material and notice is appropriate. Continuing to use Hockey Life after updated terms take effect means you accept the updated terms.
        </PolicyParagraph>
      </PolicySection>

      <PolicySection focusId="terms:contact" title="Contact">
        <PolicyParagraph>Questions about these terms can be sent to support@beerleaguehockey.ca.</PolicyParagraph>
      </PolicySection>
    </PolicyPage>
  );
}