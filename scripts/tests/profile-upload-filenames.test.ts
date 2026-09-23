import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { profileImageExtension as registrationExtension } from '../../apps/league-builder/src/lib/profile-image-mime.ts';
import { profileImageExtension as siteExtension } from '../../apps/league-sites/src/lib/profile-image-mime.ts';
import { profileImageExtension as mobileExtension } from '../../apps/mobile/src/lib/profile-image-mime.ts';

describe('profile image filename canonicalization', () => {
  it('maps every accepted MIME type independently of weird or missing filename extensions', () => {
    for (const extension of [registrationExtension, siteExtension, mobileExtension]) {
      assert.equal(extension('image/jpeg'), 'jpg');
      assert.equal(extension('image/png'), 'png');
      assert.equal(extension('image/webp'), 'webp');
      assert.equal(extension('image/jpeg; charset=binary'), null);
      assert.equal(extension('image/svg+xml'), null);
      assert.equal(extension(''), null);
    }
  });
});
