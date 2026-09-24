'use client';

import { useEffect, useState } from 'react';
import { Button } from '@hockey-life/ui';
import { exportUserData, getUserDataSummary } from '@/lib/account/data-export-actions';

type DataSummary = {
  profileComplete: boolean;
  organizationCount: number;
  leagueCount: number;
  teamCount: number;
  consentCount: number;
  activeSessionCount: number;
};

export default function PrivacySettingsPage() {
  const [dataSummary, setDataSummary] = useState<DataSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUserDataSummary().then((summary) => {
      if (!cancelled && summary.success && summary.summary) {
        setDataSummary(summary.summary);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleExportData() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    const result = await exportUserData();
    if (result.success && result.data && result.filename) {
      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = result.filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setSuccess('Your data has been exported successfully!');
    } else {
      setError(result.error || 'Failed to export data');
    }
    setLoading(false);
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold text-neutral-100 mb-2">Privacy & Data</h1>
      <p className="text-neutral-400 mb-8">Manage your personal data and privacy choices.</p>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 mb-6">
          <p className="text-sm text-green-400">{success}</p>
        </div>
      )}

      <div className="bg-neutral-800/50 border border-white/10 rounded-2xl p-6 mb-6">
        <h2 className="text-xl font-semibold text-neutral-100 mb-4">Download Your Data</h2>
        <p className="text-neutral-400 mb-4">GDPR Article 15 & 20: Right to Access and Data Portability</p>

        {dataSummary && (
          <div className="bg-neutral-900/50 rounded-xl p-4 mb-4">
            <h3 className="text-sm font-medium text-neutral-300 mb-2">Your Data Summary</h3>
            <dl className="grid grid-cols-2 gap-4 text-sm">
              {[
                ['Organizations', dataSummary.organizationCount],
                ['Leagues', dataSummary.leagueCount],
                ['Teams', dataSummary.teamCount],
                ['Active Sessions', dataSummary.activeSessionCount],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-neutral-500">{label}</dt>
                  <dd className="text-rink-500 font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        <p className="text-sm text-neutral-400 mb-4">
          Download your personal data in machine-readable JSON format.
        </p>
        <Button onClick={handleExportData} disabled={loading} variant="outline">
          {loading ? 'Exporting...' : 'Download My Data (JSON)'}
        </Button>
      </div>

      <div className="bg-neutral-800/50 border border-white/10 rounded-2xl p-6">
        <h2 className="text-xl font-semibold text-neutral-100 mb-4">Account Deletion</h2>
        <p className="text-neutral-400">
          Immediate account deletion is available from Profile in the authenticated Hockey Life mobile app.
          If you cannot access the app, contact the Privacy Team below.
        </p>
      </div>

      <div className="mt-8 pt-6 border-t border-white/10">
        <h3 className="text-sm font-medium text-neutral-300 mb-2">More Information</h3>
        <div className="flex gap-4 text-sm">
          <a href="/privacy" target="_blank" className="text-rink-500 hover:text-rink-400 hover:underline transition-colors">Privacy Policy</a>
          <a href="/terms" target="_blank" className="text-rink-500 hover:text-rink-400 hover:underline transition-colors">Terms of Service</a>
          <a href="mailto:privacy@beerleaguehockey.ca" className="text-rink-500 hover:text-rink-400 hover:underline transition-colors">Contact Privacy Team</a>
        </div>
      </div>
    </div>
  );
}
