import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ArrowLeft } from 'lucide-react';

export default function PrivacyPolicyPage() {
  const t = useTranslations('legal');

  return (
    <div className="min-h-screen bg-neutral-950 py-12">
      <div className="max-w-4xl mx-auto px-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-neutral-400 hover:text-rink-500 transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          {t('backToHome')}
        </Link>

        <h1 className="text-4xl font-bold text-rink-500 mb-4">
          {t('privacyTitle')}
        </h1>

        <div className="prose prose-invert max-w-none">
          <p className="text-sm text-neutral-500 mb-8">
            {t('lastUpdated', { date: 'January 30, 2026' })}
          </p>

          <p className="text-neutral-300 mb-8">
            {t('privacyIntro')}
          </p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              1. Information We Collect
            </h2>

            <h3 className="text-xl font-medium text-neutral-100 mb-2">
              Personal Information
            </h3>
            <ul className="list-disc list-inside text-neutral-300 mb-4 space-y-2">
              <li><strong className="text-rink-500">Account Information:</strong> Name, email address, password (encrypted)</li>
              <li><strong className="text-rink-500">Profile Information:</strong> Player position, skill level, availability preferences, profile photo</li>
              <li><strong className="text-rink-500">Organization Information:</strong> Organization name, league details</li>
            </ul>

            <h3 className="text-xl font-medium text-neutral-100 mb-2">
              Technical Information
            </h3>
            <ul className="list-disc list-inside text-neutral-300 mb-4 space-y-2">
              <li><strong className="text-rink-500">Session Data:</strong> IP address, browser type, device information (retained for 14 days)</li>
              <li><strong className="text-rink-500">Security Logs:</strong> Login attempts, account changes (retained for 1 year)</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              2. How We Use Your Information
            </h2>
            <ul className="list-disc list-inside text-neutral-300 mb-4 space-y-2">
              <li>Provide, maintain, and improve our services</li>
              <li>Create and manage your account</li>
              <li>Facilitate league and team management</li>
              <li>Send you important service notifications</li>
              <li>Detect and prevent fraud and abuse</li>
              <li>Comply with legal obligations</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              3. Data Sharing and Third Parties
            </h2>
            <ul className="list-disc list-inside text-neutral-300 mb-4 space-y-2">
              <li><strong className="text-rink-500">Supabase:</strong> Database and authentication (GDPR-compliant, SOC 2 certified)</li>
              <li><strong className="text-rink-500">Stripe:</strong> Payment processing (PCI-DSS Level 1 certified)</li>
              <li><strong className="text-rink-500">Resend:</strong> Transactional email delivery</li>
            </ul>
            <p className="text-neutral-300 mb-4">
              <strong className="text-rink-500">We do NOT sell your personal information to anyone.</strong>
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              4. Your Rights
            </h2>
            <ul className="list-disc list-inside text-neutral-300 mb-4 space-y-2">
              <li><strong className="text-rink-500">Right to Access:</strong> Request a copy of your data</li>
              <li><strong className="text-rink-500">Right to Rectification:</strong> Update incorrect information</li>
              <li><strong className="text-rink-500">Right to Erasure:</strong> Delete your account and data</li>
              <li><strong className="text-rink-500">Right to Data Portability:</strong> Download your data in JSON format</li>
            </ul>
            <p className="text-neutral-300 mb-4">
              To exercise these rights, visit your account settings or contact us at{' '}
              <a href="mailto:privacy@beerleaguehockey.ca" className="text-rink-500 hover:text-rink-400 hover:underline transition-colors">
                privacy@beerleaguehockey.ca
              </a>
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              5. Security
            </h2>
            <ul className="list-disc list-inside text-neutral-300 mb-4 space-y-2">
              <li>Encryption in transit (HTTPS/TLS)</li>
              <li>Encryption at rest for database storage</li>
              <li>Row-level security policies to prevent unauthorized access</li>
              <li>Regular security audits and monitoring</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              6. Contact Us
            </h2>
            <p className="text-neutral-300 mb-4">
              {t('contactEmail', { email: 'privacy@beerleaguehockey.ca' })}
            </p>
            <ul className="list-none text-neutral-300 mb-4 space-y-2">
              <li><strong className="text-rink-500">Email:</strong> privacy@beerleaguehockey.ca</li>
              <li><strong className="text-rink-500">Data Protection Officer:</strong> dpo@beerleaguehockey.ca</li>
              <li><strong className="text-rink-500">Security Concerns:</strong> security@beerleaguehockey.ca</li>
            </ul>
          </section>

          <section id="hockey-life-mobile" className="mb-8" aria-label="Hockey Life mobile addendum">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">Hockey Life mobile addendum</h2>
            <p className="text-sm text-neutral-500 mb-4">Mobile addendum updated: November 4, 2026</p>
            <p className="text-neutral-300 mb-4">This addendum applies only to the Hockey Life mobile app. The broader platform disclosures above remain in place for platform services; the app-specific descriptions below explain the mobile app’s data practices, including retention after account deletion, rather than assigning platform session or security-log retention periods to all mobile records.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Information we collect</h3>
              <p className="text-neutral-300 mb-4">Account and profile information, such as your name, email address, profile details, and account identifiers.</p>
              <p className="text-neutral-300 mb-4">Roster, league, game participation, and statistics connected to your Hockey Life activity.</p>
              <p className="text-neutral-300 mb-4">Your availability, attendance, and app interactions, including responses and actions you take in the app.</p>
              <p className="text-neutral-300 mb-4">Support submissions, including abuse or privacy reports: report content, the information you provide, relevant account and content identifiers, and league, team, or game context. We use this information to review requests, investigate misuse, and administer safety actions, with access limited to staff authorized to handle them. Where reporting or blocking features are available, we also process report context and blocked-user preferences to apply those choices; availability varies by app version and feature.</p>
              <p className="text-neutral-300 mb-4">An optional Expo push token linked to your account and notification preferences when you choose to enable notifications.</p>
              <p className="text-neutral-300 mb-4">Necessary technical and security data, such as device and app information, request records, and diagnostics used to operate and protect the service.</p>
              <p className="text-neutral-300 mb-4">Signed waivers, including the minimum information needed to show what was accepted and when.</p>
              <p className="text-neutral-300 mb-4">Payment, audit, and tax records, such as amounts, currency, status, and dates. Stripe processes payment-card details; Hockey Life does not collect or retain full payment-card numbers.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Operational user content</h3>
              <p className="text-neutral-300 mb-4">Scoreboard commentary is shared with currently authorized captains and alternate captains for the same team and game, including a different co-leader or successor. It is not a public feed or a note visible only to its author.</p>
              <p className="text-neutral-300 mb-4">Optional spare-request messages are stored with invitations and operational request records. Access is limited to the invited player, authorized team captains, and authorized operational staff; the app does not currently display a recipient inbox or deliver these messages by email or push.</p>
              <p className="text-neutral-300 mb-4">Manually entered spare-player names can appear in public accepted-substitution listings and related team or game views, even if the player is not saved to a permanent roster. A captain may enter the name on another player’s behalf.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">How we use information</h3>
              <p className="text-neutral-300 mb-4">We use information to create and maintain accounts, show the right league and team experience, operate rosters and game records, record availability and attendance, deliver requested notifications, answer support requests, troubleshoot problems, prevent misuse, and improve Hockey Life.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">When we share information</h3>
              <p className="text-neutral-300 mb-4">Information relevant to a league may be visible to league organizers, team leaders, teammates, participants, or the public according to the league feature and the organizer’s settings. League organizers may use that information to administer their leagues.</p>
              <p className="text-neutral-300 mb-4">We may share information with service providers that help host, deliver, support, monitor, or secure Hockey Life. They receive only the information reasonably needed to provide those services. We may also disclose information when required by law or when reasonably necessary to protect users, the service, or others.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">No sale of personal data</h3>
              <p className="text-neutral-300 mb-4">We do not sell your personal data.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Retention</h3>
              <p className="text-neutral-300 mb-4">We keep information for as long as it is reasonably needed to provide Hockey Life, maintain league and game records, meet legal or operational obligations, resolve disputes, and protect the service. Retention can differ by information type and league context. We delete or de-identify information when it is no longer reasonably needed, subject to legitimate recordkeeping needs.</p>
              <p className="text-neutral-300 mb-4">After account deletion, signed waivers retain their minimum evidentiary fields and are not anonymous. Minimum payment, audit, and tax facts retain legal identifiers and are not anonymous. Hockey Life clears Stripe handles, metadata, idempotency material, reminders, and free text from those retained payment records.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Security</h3>
              <p className="text-neutral-300 mb-4">We use reasonable administrative and technical safeguards appropriate to the service. No storage or transmission method is completely secure, so we cannot promise absolute security. Protect your sign-in information and contact support if you believe your account has been misused.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Your choices and requests</h3>
              <p className="text-neutral-300 mb-4">You can update the profile fields available in your app version; public name and photo editing are currently disabled in the mobile app. You can request account deletion in the app’s Account section. You may also ask to access, correct, or delete personal information by emailing support@beerleaguehockey.ca. We may need to verify your request, and some league, safety, legal, or operational records may need to be retained. Account deletion does not guarantee removal of every mention of you in shared league content or retained operational records.</p>
              <p className="text-neutral-300 mb-4">Push notifications are optional. You can change notification preferences in Hockey Life or your device settings. Turning them off does not prevent you from using the rest of the app.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Children</h3>
              <p className="text-neutral-300 mb-4">Hockey Life is not directed to children under 13. If you believe a child under 13 has provided personal information through the app, contact us so we can review the situation.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Policy updates</h3>
              <p className="text-neutral-300 mb-4">We may update this policy as Hockey Life or applicable requirements change. We will update the date shown here and provide additional notice in the app when an update is material and notice is appropriate.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Contact</h3>
              <p className="text-neutral-300 mb-4">Questions or privacy requests can be sent to support@beerleaguehockey.ca.</p>
            <p className="text-neutral-300 mb-4"><Link href="/mobile-support" className="text-rink-500 hover:underline">Hockey Life mobile support</Link></p>
          </section>
        </div>
      </div>
    </div>
  );
}
