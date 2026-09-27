import {
  adjustNewspaperZoom,
  calculateNewspaperFitScale,
  clampNewspaperZoom,
  getNewspaperViewerStyle,
} from '../NewspaperEditionViewer';

describe('NewspaperEditionViewer sizing', () => {
  it('fits the fixed-layout renderer to its iframe without forcing a desktop width', () => {
    const style = getNewspaperViewerStyle(null);

    expect(style).toContain('data-newspaper-viewer-fit');
    expect(style).toContain('min(1,calc((100vw - 24px) / 853px))');
    expect(style).toContain('zoom:var(--viewer-scale)');
    expect(style).not.toContain('min-width:909px');
    expect(style).not.toContain('transform:scale');
    expect(calculateNewspaperFitScale(390)).toBeCloseTo(366 / 853);
    expect(calculateNewspaperFitScale(1440)).toBe(1);
    expect(calculateNewspaperFitScale(0)).toBe(1);
  });

  it('creates a scroll-accessible fixed-layout manual zoom override', () => {
    const style = getNewspaperViewerStyle(1.25);

    expect(style).toContain('--viewer-scale:1.25');
    expect(style).toContain('zoom:var(--viewer-scale)');
    expect(style).toContain('width:max-content');
    expect(style).not.toContain('min-width:909px');
    expect(style).not.toContain('transform:scale');
  });

  it('clamps manual zoom while allowing useful phone zoom-out and zoom-in', () => {
    expect(clampNewspaperZoom(0)).toBe(0.1);
    expect(clampNewspaperZoom(1.25)).toBe(1.25);
    expect(clampNewspaperZoom(3)).toBe(2);
    expect(adjustNewspaperZoom(null, 0.4, 1)).toBe(0.65);
    expect(adjustNewspaperZoom(0.75, 0.55, 1)).toBe(1);
    expect(adjustNewspaperZoom(null, 0.38, -1)).toBeCloseTo(0.13);
    expect(adjustNewspaperZoom(0.75, 0.3, -1)).toBe(0.5);
  });
});
