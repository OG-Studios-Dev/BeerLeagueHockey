import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(`../../${relativePath}`, import.meta.url).toString()), 'utf8');
}

describe('minimum-v1 social surface', () => {
  it('does not load, render, or post a team bulletin from a reachable screen', () => {
    const team = source('src/screens/TeamScreen/TeamDetailScreen.tsx');

    assert.doesNotMatch(team, /getRecentTeamMessages|postTeamMessage|TeamMessageRow/);
    assert.doesNotMatch(team, /Team Bulletin|team-bulletin-card|team-captain-reminder-action/);
  });

  it('keeps captain operations structured and removes arbitrary message and notes inputs', () => {
    const team = source('src/screens/TeamScreen/TeamDetailScreen.tsx');

    assert.doesNotMatch(team, /subInviteMessage|goalieNotes|reminderMessage/);
    assert.doesNotMatch(team, /Optional message to the player|Anything the goalie should know|Write the reminder/);
    assert.match(team, /GOALIE_COMPENSATION_OPTIONS/);
  });

  it('keeps lineup notes and chat out of every registered route contract', () => {
    for (const relativePath of [
      'src/navigation/index.tsx',
      'src/navigation/types.ts',
      'src/navigation/screenRegistry.ts',
      'src/components/cutIceTitleModel.ts',
    ]) {
      const value = source(relativePath);
      assert.doesNotMatch(value, /LineupNotes|TeamChat/, relativePath);
    }
  });
});

describe('minimum-v1 reviewer controls', () => {
  it('removes the unproven captain invitation action and route from minimum v1', () => {
    const dashboard = source('src/screens/captain/CaptainDashboardScreen.tsx');
    assert.doesNotMatch(dashboard, /InvitePlayers|person-add-outline|>Invite</);

    for (const relativePath of [
      'src/navigation/index.tsx',
      'src/navigation/types.ts',
      'src/navigation/screenRegistry.ts',
    ]) {
      assert.doesNotMatch(source(relativePath), /InvitePlayers/, relativePath);
    }
  });

  it('does not expose generic registration or payment destinations', () => {
    const profile = source('src/screens/ProfileScreen.tsx');
    const menu = source('src/navigation/dockMenu.ts');

    assert.doesNotMatch(profile, /Registration &amp; Payments|\/register/);
    assert.doesNotMatch(menu, /label: ['"]Register['"]|goalies\/register/);
  });
});

describe('single-league reviewer copy', () => {
  it('contains no cross-league platform branding in reachable display sources', () => {
    const reachableSources = [
      'src/components/SectionHeader.tsx',
      'src/navigation/MobileWebDock.tsx',
      'src/screens/EditProfileScreen.tsx',
      'src/screens/NotificationsFeedScreen.tsx',
      'src/screens/ProfileScreen.tsx',
      'src/screens/games/GameRecapScreen.tsx',
      'src/screens/stats/CareerStatsScreen.tsx',
    ];

    for (const relativePath of reachableSources) {
      const value = source(relativePath);
      assert.doesNotMatch(value, /Beer League Hockey|\bBLH\b|cross-league|All leagues/i, relativePath);
    }
  });
});

describe('minimum-v1 permissions and privacy inventory', () => {
  it('declares only permissions used by reachable source', () => {
    const app = JSON.parse(source('app.json')).expo;
    const packageJson = JSON.parse(source('package.json'));

    assert.equal(app.ios.infoPlist.NSLocationWhenInUseUsageDescription, undefined);
    assert.equal(app.ios.infoPlist.NSCameraUsageDescription, undefined);
    assert.deepEqual(app.android.permissions ?? [], []);
    assert.equal(JSON.stringify(app.plugins).includes('expo-location'), false);
    assert.equal(packageJson.dependencies['expo-location'], undefined);
    assert.doesNotMatch(source('src/lib/leagueMarketplace.ts'), /expo-location|requestForegroundPermissions/);
    assert.doesNotMatch(source('src/components/LeagueMarketplace.tsx'), /expo-location/);
  });

  it('documents current data use and leaves App Store Connect answers explicitly business-owned', () => {
    const privacy = source('APP_STORE_PRIVACY.md');

    assert.match(privacy, /Authentication/i);
    assert.match(privacy, /Profile/i);
    assert.match(privacy, /Push notification/i);
    assert.match(privacy, /Calendar/i);
    assert.match(privacy, /does not request photo-library/i);
    assert.match(privacy, /does not collect a public player name/i);
    assert.match(privacy, /league administrators remain responsible for approved identity changes/i);
    assert.match(privacy, /business-owned/i);
    assert.match(privacy, /App Store Connect/i);
    assert.doesNotMatch(privacy, /metadata (?:has been|was) submitted/i);
  });
});
