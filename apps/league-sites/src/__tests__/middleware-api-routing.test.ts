import { config } from '@/middleware';

describe('league-sites middleware API routing', () => {
  it('keeps API routes outside tenant page rewrites', () => {
    const matcher = config.matcher.join('\n');
    expect(matcher).toContain('(?!api|');
    expect(matcher).toContain('_next/static');

    const configuredPattern = new RegExp(`^${config.matcher[0]}$`);
    expect(configuredPattern.test('/api/public/home')).toBe(false);
    expect(configuredPattern.test('/hockey-life')).toBe(true);
  });
});
