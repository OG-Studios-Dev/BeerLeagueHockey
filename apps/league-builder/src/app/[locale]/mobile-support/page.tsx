import type { Metadata } from 'next';
import { Link } from '@/i18n/navigation';

export const metadata: Metadata = {
  title: 'Hockey Life mobile support',
  description: 'Technical help for the Hockey Life mobile app.',
};

export default function MobileSupportPage() {
  return (
    <main className="min-h-screen bg-neutral-950 py-12 text-neutral-300">
      <div className="max-w-3xl mx-auto px-4 space-y-6">
        <Link href="/" className="text-rink-500 hover:underline">Back to home</Link>
        <h1 className="text-4xl font-bold text-rink-500">Hockey Life mobile support</h1>
        <p>For technical help with the Hockey Life iOS or Android app, account access, notifications, or a privacy request, email <a href="mailto:support@beerleaguehockey.ca" className="text-rink-500 hover:underline">support@beerleaguehockey.ca</a>. You do not need to sign in to view this page or contact support.</p>
        <h2 className="text-2xl font-semibold text-neutral-100">What to include</h2>
        <ul className="list-disc pl-6 space-y-2">
          <li>The app version, device model, and operating system version.</li>
          <li>A description of the issue, the steps to reproduce it, and what you expected to happen.</li>
          <li>When it happened, including your time zone, and the relevant league or team name.</li>
          <li>A screenshot if useful, with personal or sensitive information removed.</li>
        </ul>
        <p>Do not send passwords, sign-in or verification codes, payment-card numbers, security codes, or other credentials. Share only the information needed to explain the issue.</p>
        <h2 className="text-2xl font-semibold text-neutral-100">Report abuse or objectionable content</h2>
        <p>Email <a href="mailto:support@beerleaguehockey.ca" className="text-rink-500 hover:underline">support@beerleaguehockey.ca</a> with the subject “Report abuse”. Include where you saw the content, the league or team, the game date if relevant, and why you are reporting it. Include a public page link or a brief description that helps identify the content; share only the details needed to locate and assess the concern.</p>
        <p>Do not forward private team commentary or other players’ personal information unnecessarily. If a screenshot is needed, remove unrelated personal or sensitive information. Use the same email for privacy concerns or help finding reporting options available in your app version.</p>
        <p>For schedules, roster eligibility, attendance corrections, or spare-fee payment arrangements, contact your league organizer. The mobile spare-fee ledger records real-world hockey fees; marking a fee paid does not charge your card in the app.</p>
        <nav aria-label="Mobile policies" className="flex gap-6">
          <Link href="/privacy" className="text-rink-500 hover:underline">Privacy policy</Link>
          <Link href="/terms" className="text-rink-500 hover:underline">Terms of service</Link>
        </nav>
      </div>
    </main>
  );
}
