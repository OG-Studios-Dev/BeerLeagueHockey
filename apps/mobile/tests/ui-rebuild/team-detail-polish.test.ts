import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const teamDetail = readFileSync(
  fileURLToPath(new URL('../../src/screens/TeamScreen/TeamDetailScreen.tsx', import.meta.url).toString()),
  'utf8',
);
const navigation = readFileSync(
  fileURLToPath(new URL('../../src/navigation/index.tsx', import.meta.url).toString()),
  'utf8',
);

describe('Team detail polish contract', () => {
  it('renders the public Team page without duplicated operations or captain cards', () => {
    assert.match(teamDetail, /<TeamPublicPage/);
    assert.doesNotMatch(teamDetail, /team-operations-card|Team Operations/);
    assert.doesNotMatch(teamDetail, /Captain Center|team-captain-sub-action|team-captain-goalie-action/);
  });

  it('retains the existing role-gated captain route registrations', () => {
    assert.match(navigation, /name="CaptainDashboard"/);
    assert.match(navigation, /name="GameAvailability"/);
  });
});
