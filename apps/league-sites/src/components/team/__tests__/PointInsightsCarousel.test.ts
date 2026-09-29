import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PointInsightsCarousel } from '../PointInsightsCarousel';

describe('PointInsightsCarousel', () => {
  it('renders mapped content and controls for multiple insights', () => {
    const html = renderToStaticMarkup(React.createElement(PointInsightsCarousel, { insights: [
      { key: 'ppg', label: 'Points pace', text: 'First insight' },
      { key: 'rank', label: 'League rank', text: 'Second insight' },
    ] }));
    expect(html).toContain('lucide-trending-up');
    expect(html).toContain('Points Insights');
    expect(html).toContain('First insight');
    expect(html).toContain('aria-label="Previous insight"');
    expect(html).toContain('aria-label="Next insight"');
  });

  it('uses the fallback icon for an unknown insight identity', () => {
    const html = renderToStaticMarkup(React.createElement(PointInsightsCarousel, {
      insights: [{ key: 'unknown', label: 'New metric', text: 'Fallback insight' }],
    }));
    expect(html).toContain('lucide-chart-column');
    expect(html).toContain('Fallback insight');
    expect(html).not.toContain('<button');
  });

  it('renders nothing for an empty insight set', () => {
    expect(renderToStaticMarkup(React.createElement(PointInsightsCarousel, { insights: [] }))).toBe('');
  });
});
