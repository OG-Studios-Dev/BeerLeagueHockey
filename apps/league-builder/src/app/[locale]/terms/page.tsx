import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { ArrowLeft } from 'lucide-react';

export default function TermsOfServicePage() {
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
          {t('termsTitle')}
        </h1>

        <div className="prose prose-invert max-w-none">
          <p className="text-sm text-neutral-500 mb-8">
            {t('lastUpdated', { date: 'January 30, 2026' })}
          </p>

          <p className="text-neutral-300 mb-8">
            {t('termsIntro')}
          </p>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              1. Acceptance of Terms
            </h2>
            <p className="text-neutral-300 mb-4">
              By accessing and using Beer League Hockey (&quot;the Service&quot;), you accept and agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              2. Description of Service
            </h2>
            <p className="text-neutral-300 mb-4">
              Beer League Hockey is a software-as-a-service (SaaS) platform that provides hockey league management tools, including:
            </p>
            <ul className="list-disc list-inside text-neutral-300 mb-4 space-y-2">
              <li>League creation and administration</li>
              <li>Team roster management</li>
              <li>Game scheduling and statistics tracking</li>
              <li>Player registration and profile management</li>
              <li>Payment processing for league fees</li>
              <li>Communication tools for league administrators and players</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              3. Account Registration
            </h2>
            <p className="text-neutral-300 mb-4">
              To use certain features of the Service, you must register for an account. You agree to:
            </p>
            <ul className="list-disc list-inside text-neutral-300 mb-4 space-y-2">
              <li>Provide accurate, current, and complete information during registration</li>
              <li>Maintain and update your information to keep it accurate and current</li>
              <li>Keep your password secure and confidential</li>
              <li>Notify us immediately of any unauthorized use of your account</li>
              <li>Accept responsibility for all activities under your account</li>
            </ul>
            <p className="text-neutral-300 mb-4">
              You must be at least 13 years old to create an account. If you are under 18, you must have parental consent to use the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              4. User Conduct
            </h2>
            <p className="text-neutral-300 mb-4">
              You agree NOT to:
            </p>
            <ul className="list-disc list-inside text-neutral-300 mb-4 space-y-2">
              <li>Use the Service for any illegal purpose or in violation of any laws</li>
              <li>Violate the intellectual property rights of Beer League Hockey or others</li>
              <li>Upload or transmit viruses, malware, or malicious code</li>
              <li>Harass, abuse, or harm other users</li>
              <li>Impersonate any person or entity</li>
              <li>Interfere with or disrupt the Service or servers</li>
              <li>Attempt to gain unauthorized access to the Service or user accounts</li>
              <li>Use automated systems (bots, scrapers) without permission</li>
              <li>Resell or redistribute the Service without authorization</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              5. Pricing and Payment
            </h2>
            <p className="text-neutral-300 mb-4">
              <strong className="text-rink-500">Transaction Fee:</strong> When you process payments through Beer League Hockey (e.g., player registration fees), a 3.5% platform fee is applied to each transaction. This is separate from Stripe&apos;s own card processing fees.
            </p>
            <p className="text-neutral-300 mb-4">
              <strong className="text-rink-500">Payment Processing:</strong> All payments are processed securely through Stripe Connect. League administrators receive funds directly to their connected Stripe account.
            </p>
            <p className="text-neutral-300 mb-4">
              <strong className="text-rink-500">Fee Changes:</strong> We reserve the right to change fees with 30 days&apos; notice. Per-league fee agreements are honored for their agreed term.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              6. Intellectual Property
            </h2>
            <p className="text-neutral-300 mb-4">
              The Service, including its design, code, graphics, and content, is owned by Beer League Hockey and protected by copyright, trademark, and other intellectual property laws.
            </p>
            <p className="text-neutral-300 mb-4">
              <strong className="text-rink-500">Your Content:</strong> You retain ownership of content you upload (team names, player rosters, game stats). By uploading content, you grant us a license to use, store, and display it as necessary to provide the Service.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              7. Data and Privacy
            </h2>
            <p className="text-neutral-300 mb-4">
              Your use of the Service is also governed by our{' '}
              <Link href="/privacy" className="text-rink-500 hover:text-rink-400 hover:underline transition-colors">
                Privacy Policy
              </Link>
              , which describes how we collect, use, and protect your personal information.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              8. Limitation of Liability
            </h2>
            <p className="text-neutral-300 mb-4 uppercase font-semibold">
              THE SERVICE IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTIES OF ANY KIND. TO THE MAXIMUM EXTENT PERMITTED BY LAW, BEER LEAGUE HOCKEY SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, OR CONSEQUENTIAL DAMAGES.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">
              9. Contact Us
            </h2>
            <p className="text-neutral-300 mb-4">
              {t('contactEmail', { email: 'legal@beerleaguehockey.ca' })}
            </p>
            <ul className="list-none text-neutral-300 mb-4 space-y-2">
              <li><strong className="text-rink-500">Email:</strong> legal@beerleaguehockey.ca</li>
              <li><strong className="text-rink-500">Support:</strong> support@beerleaguehockey.ca</li>
            </ul>
          </section>

          <section id="hockey-life-mobile" className="mb-8" aria-label="Hockey Life mobile addendum">
            <h2 className="text-2xl font-semibold text-neutral-100 mb-4">Hockey Life mobile addendum</h2>
            <p className="text-sm text-neutral-500 mb-4">Mobile addendum updated: November 4, 2026</p>
            <p className="text-neutral-300 mb-4">This addendum applies only to use of the Hockey Life mobile app. The broader platform terms above remain in place for platform services. The app-specific descriptions below explain mobile participation and do not describe a new platform subscription or digital purchase.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Acceptance</h3>
              <p className="text-neutral-300 mb-4">By creating an account or using Hockey Life, you agree to these terms. If you do not agree, do not use the app. A league may have additional organizer rules for participation; those rules apply alongside these app terms.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Account accuracy and security</h3>
              <p className="text-neutral-300 mb-4">Provide accurate, current information and keep it updated. Keep your sign-in details private, do not share access to your account, and tell support promptly if you believe someone else has used it. You are responsible for activity performed through your account to the extent permitted by law.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">League participation and conduct</h3>
              <p className="text-neutral-300 mb-4">Follow applicable organizer rules, team expectations, rink policies, and reasonable instructions from league officials. Treat players, organizers, officials, and other users respectfully. Hockey Life supports league operations but does not replace decisions made by league organizers about eligibility, rosters, discipline, or competition.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Availability, schedules, and stats</h3>
              <p className="text-neutral-300 mb-4">Availability responses, attendance, schedules, scores, standings, and stats are operational records used to run league activities. They may change because of organizer corrections, game changes, delayed reporting, data review, or technical issues. Check with your league when a record affects participation or another time-sensitive decision.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Your submissions and content</h3>
              <p className="text-neutral-300 mb-4">You keep ownership of content you submit. You give Hockey Life and the relevant league organizers a non-exclusive permission to host, copy, display, and use that content only as reasonably needed for operating and promoting Hockey Life and league services. You confirm that you have the right to submit the content and that using it this way does not violate another person’s rights.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Prohibited conduct</h3>
              <p className="text-neutral-300 mb-4">Do not misuse Hockey Life. In particular, do not:</p>
              <p className="text-neutral-300 mb-4">Access another person’s account or data without permission.</p>
              <p className="text-neutral-300 mb-4">Harass, threaten, impersonate, or deceive another person.</p>
              <p className="text-neutral-300 mb-4">Submit unlawful, infringing, malicious, or deliberately false content.</p>
              <p className="text-neutral-300 mb-4">Probe, disrupt, overload, scrape, reverse engineer, or bypass security or access controls except where applicable law expressly permits it.</p>
              <p className="text-neutral-300 mb-4">Use the app in a way that interferes with league operations or another person’s use of the service.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Third-party, device, and network services</h3>
              <p className="text-neutral-300 mb-4">Hockey Life depends on your device, operating system, app store, network connection, notification services, and other service providers. Their terms and availability may affect app features. We are not responsible for third-party services that we do not control.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Suspension and termination</h3>
              <p className="text-neutral-300 mb-4">Access may be limited, suspended, or ended when reasonably necessary to address misuse, security concerns, legal requirements, material violations of these terms, or league access changes. You may stop using the app at any time and can contact support about account deletion, subject to records that must reasonably be retained.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Service changes and availability</h3>
              <p className="text-neutral-300 mb-4">We may add, change, limit, or remove app features and may perform maintenance. We work to keep Hockey Life useful and available, but we cannot promise that every feature will always be available, uninterrupted, or error-free.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Disclaimers and limits</h3>
              <p className="text-neutral-300 mb-4">Hockey Life is provided on an “as available” basis. To the extent permitted by law, we are not responsible for indirect, incidental, or consequential losses resulting from use of the app or from records supplied by users or league organizers. These terms do not exclude consumer rights or any responsibility that cannot lawfully be excluded or limited.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Updates to these terms</h3>
              <p className="text-neutral-300 mb-4">We may update these terms as the app or applicable requirements change. We will update the date shown here and provide additional notice in the app when a change is material and notice is appropriate. Continuing to use Hockey Life after updated terms take effect means you accept the updated terms.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Contact</h3>
              <p className="text-neutral-300 mb-4">Questions about these terms can be sent to support@beerleaguehockey.ca.</p>
            <h3 className="text-xl font-medium text-neutral-100 mb-2">Spare fees for real-world hockey</h3>
            <p className="text-neutral-300 mb-4">The current mobile app provides a manual spare-fee ledger for real-world hockey participation. Recording a fee or marking it paid does not charge a payment card in the native app. Confirm amounts, payment arrangements, corrections, and any refund questions with your league organizer. The platform payment-processing terms above describe platform payment services, not a card charge initiated by this mobile ledger.</p>
            <p className="text-neutral-300 mb-4"><Link href="/mobile-support" className="text-rink-500 hover:underline">Hockey Life mobile support</Link></p>
          </section>
        </div>
      </div>
    </div>
  );
}
