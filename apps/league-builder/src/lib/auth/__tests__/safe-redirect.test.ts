import { safeRedirectPath } from '../safe-redirect';

describe('safeRedirectPath', () => {
  it('returns dashboard for null input', () => {
    expect(safeRedirectPath(null)).toBe('/en/dashboard');
  });

  it('returns dashboard for empty string', () => {
    expect(safeRedirectPath('')).toBe('/en/dashboard');
  });

  it('allows relative paths starting with /', () => {
    expect(safeRedirectPath('/en/dashboard/settings')).toBe('/en/dashboard/settings');
    expect(safeRedirectPath('/fr/dashboard')).toBe('/fr/dashboard');
    expect(safeRedirectPath('/')).toBe('/');
  });

  it('blocks protocol-relative URLs (//evil.com)', () => {
    expect(safeRedirectPath('//evil.com')).toBe('/en/dashboard');
    expect(safeRedirectPath('//evil.com/path')).toBe('/en/dashboard');
  });

  it('blocks backslash variants that URL parsing treats as cross-origin', () => {
    expect(safeRedirectPath('/\\evil.com/path')).toBe('/en/dashboard');
    expect(safeRedirectPath('/path\\to\\resource')).toBe('/en/dashboard');
  });

  it('blocks absolute URLs with protocol', () => {
    expect(safeRedirectPath('https://evil.com')).toBe('/en/dashboard');
    expect(safeRedirectPath('http://evil.com/callback')).toBe('/en/dashboard');
    expect(safeRedirectPath('javascript:alert(1)')).toBe('/en/dashboard');
  });

  it('blocks paths that do not start with /', () => {
    expect(safeRedirectPath('evil.com')).toBe('/en/dashboard');
    expect(safeRedirectPath('dashboard')).toBe('/en/dashboard');
  });

  it('allows paths with query strings and fragments', () => {
    expect(safeRedirectPath('/en/dashboard?tab=billing')).toBe('/en/dashboard?tab=billing');
    expect(safeRedirectPath('/settings#section')).toBe('/settings#section');
  });
});
