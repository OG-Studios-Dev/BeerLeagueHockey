'use client';

import { Link } from '@/i18n/navigation';

const pricingColumns = [
  {
    label: 'League pays',
    title: 'Stripe processing fees',
    body: "The league's connected Stripe account covers Stripe processing. That keeps the payment processor separate from BLH's software pricing.",
  },
  {
    label: 'Players pay',
    title: 'The BLH platform fee at checkout',
    body: 'BLH is designed so the platform fee can ride with online player checkout instead of showing up as a second software bill for the commissioner.',
  },
  {
    label: 'Switching leagues',
    title: 'Partner pricing for qualified migrations',
    body: 'Qualified leagues can access first-season partner pricing as low as 1.5% while we scope migration, payment mix, and onboarding around the rollout.',
  },
];

const includedItems = [
  'Registrations and player checkout',
  'Schedules, standings, skater stats, and goalie stats',
  'Public league website, sponsors, and news',
  'Commissioner controls for balances, reminders, and season setup',
];

const faqItems = [
  {
    question: 'Does the league pay Stripe or BLH?',
    answer:
      "Stripe processing fees are paid by the league through its connected Stripe account. BLH's platform fee is separate from Stripe.",
  },
  {
    question: 'Who pays the BLH fee?',
    answer:
      'BLH is built so the platform fee can be passed through player checkout by default for leagues running online registration.',
  },
  {
    question: 'Is the website included?',
    answer:
      'Yes. The public league website is part of the platform, not a separate website vendor or add-on product.',
  },
  {
    question: 'What if we are switching from spreadsheets or another platform?',
    answer:
      'That is where first-season partner pricing and migration scoping come in. We plan the transition around your payment mix, current data, and season timing.',
  },
];

export function CallToAction() {
  return (
    <section
      id="pricing"
      className="relative w-full overflow-hidden border-t border-white/[0.07] bg-[#05080d] py-24 md:py-32"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.18),transparent_58%)]" />

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-accent">
            Pricing the league can actually explain
          </p>
          <h2 className="mt-4 font-heading text-4xl font-bold uppercase tracking-tight text-white sm:text-5xl md:text-6xl">
            League pays Stripe. Players pay BLH.
          </h2>
          <p className="mt-5 text-lg leading-8 text-neutral-300">
            That is the cleanest public version of the model. The website is included, the public
            league experience is included, and the software cost does not need to sit entirely on
            the commissioner&apos;s budget.
          </p>
        </div>

        <div className="mt-14 overflow-hidden rounded-[2.5rem] border border-white/10 bg-white/[0.03]">
          <div className="grid gap-0 lg:grid-cols-3">
            {pricingColumns.map((column, index) => (
              <article
                key={column.title}
                className={`px-6 py-8 md:px-8 md:py-10 ${
                  index > 0 ? 'border-t border-white/[0.08] lg:border-l lg:border-t-0' : ''
                }`}
              >
                <p className="font-mono text-xs uppercase tracking-[0.22em] text-rink-300">
                  {column.label}
                </p>
                <h3 className="mt-4 text-2xl font-bold tracking-tight text-white">{column.title}</h3>
                <p className="mt-4 text-sm leading-7 text-neutral-300">{column.body}</p>
              </article>
            ))}
          </div>
        </div>

        <div className="mt-8 grid gap-10 border-y border-white/[0.08] py-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-center">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-neutral-500">
              Included in the platform
            </p>
            <ul className="mt-5 space-y-4">
              {includedItems.map((item) => (
                <li key={item} className="flex gap-4 text-sm leading-7 text-neutral-300 md:text-base">
                  <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-accent" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-[2.2rem] border border-accent/[0.18] bg-[linear-gradient(135deg,rgba(34,211,238,0.12),rgba(255,255,255,0.03),rgba(59,130,246,0.1))] p-7 md:p-8">
            <p className="font-mono text-xs uppercase tracking-[0.22em] text-accent">
              Stripe note
            </p>
            <h3 className="mt-3 text-2xl font-bold text-white">
              Stripe processing is separate from BLH platform fees.
            </h3>
            <p className="mt-4 text-sm leading-7 text-neutral-200">
              The league pays Stripe processing fees through its connected Stripe account. Players
              pay BLH platform fees at checkout when the league is running the default pass-through
              model. That keeps the public pricing story much simpler than paying for software,
              website, and payment processing as separate line items.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/pricing"
                className="inline-flex items-center justify-center rounded-full bg-white px-6 py-4 text-base font-semibold text-[#0B1420] transition-all duration-300 hover:scale-[1.03]"
              >
                View Pricing Details
              </Link>
              <Link
                href="/book-demo"
                className="inline-flex items-center justify-center rounded-full border border-white/15 bg-white/[0.06] px-6 py-4 text-base font-semibold text-white transition-all duration-300 hover:-translate-y-[1px] hover:bg-white/10"
              >
                Talk Through Your League
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {faqItems.map((item) => (
            <article
              key={item.question}
              className="rounded-[1.75rem] border border-white/10 bg-white/[0.03] p-6"
            >
              <h3 className="text-lg font-semibold text-white">{item.question}</h3>
              <p className="mt-3 text-sm leading-7 text-neutral-400">{item.answer}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
