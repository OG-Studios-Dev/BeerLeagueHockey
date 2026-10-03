import {
  illustrationFailureMessage,
  readIllustrationFailureCode,
} from '../illustration-errors';

describe('newspaper illustration failure transport', () => {
  it('retains an allowlisted Edge code without exposing its response message', async () => {
    const error = {
      context: new Response(JSON.stringify({
        error: {
          code: 'PLAYER_PHOTO_UNRESOLVED',
          message: 'raw upstream detail must not cross the action boundary',
        },
      }), { status: 422, headers: { 'content-type': 'application/json' } }),
    };

    const code = await readIllustrationFailureCode(error);

    expect(code).toBe('PLAYER_PHOTO_UNRESOLVED');
    expect(illustrationFailureMessage(code)).toMatch(/profile photo/i);
    expect(illustrationFailureMessage(code)).not.toMatch(/raw upstream detail/i);
  });

  it.each([
    [{ context: new Response(JSON.stringify({ error: { code: 'NOT_ALLOWLISTED', message: 'private' } }), { status: 502 }) }],
    [{ context: new Response('<html>relay detail</html>', { status: 502 }) }],
    [new Error('network detail')],
  ])('collapses malformed or non-allowlisted failures to the safe generic code', async (error) => {
    await expect(readIllustrationFailureCode(error)).resolves.toBe('ILLUSTRATION_GENERATION_FAILED');
  });

  it('retains the timeout code and explains that a retry is safe', async () => {
    const error = {
      context: new Response(JSON.stringify({
        error: { code: 'ILLUSTRATION_GENERATION_TIMEOUT', message: 'safe public message' },
      }), { status: 504, headers: { 'content-type': 'application/json' } }),
    };
    const code = await readIllustrationFailureCode(error);
    expect(code).toBe('ILLUSTRATION_GENERATION_TIMEOUT');
    expect(illustrationFailureMessage(code)).toMatch(/timed out safely/i);
    expect(illustrationFailureMessage(code)).toMatch(/no edition was published/i);
  });
});
