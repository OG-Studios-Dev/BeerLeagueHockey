import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { SyncStatusBanner } from '../SyncStatusBanner';

describe('scorekeeper offline UI', () => {
  it('states that server-action changes cannot be saved while offline', () => {
    const markup = renderToStaticMarkup(
      React.createElement(SyncStatusBanner, {
        syncState: {
          isOnline: false,
          isSyncing: false,
          pendingCount: 0,
          lastError: null,
          lastSyncAt: null,
        },
      })
    );

    expect(markup).toContain('Scoring unavailable offline');
    expect(markup).toContain('Changes are not saved');
    expect(markup).not.toContain('will sync');
  });
});
