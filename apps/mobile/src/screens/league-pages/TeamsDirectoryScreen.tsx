import { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FocusCard } from '../../components/CardFocus';
import TeamLogo from '../../components/TeamLogo';
import type { LeaguePagesStackParamList } from '../../navigation/types';
import colors from '../../theme/colors';
import { LeaguePageFrame, PageLoadState, useLeaguePage, useLeaguePageScope } from './LeaguePageCommon';

type Props = NativeStackScreenProps<LeaguePagesStackParamList, 'TeamsDirectory'>;

export default function TeamsDirectoryScreen({ route, navigation }: Props) {
  const scope = useLeaguePageScope(route.params);
  const page = useLeaguePage(scope, 'teams');

  if (!page.data) {
    return <LeaguePageFrame><PageLoadState loading={page.loading} error={page.error} noSeason={false} retry={page.retry} /></LeaguePageFrame>;
  }

  return (
    <LeaguePageFrame>
      <Text accessibilityRole="header" style={styles.title}>Teams</Text>
      {page.data.selectedSeason ? (
        <View style={styles.grid}>
          {page.data.teams.map((team) => (
            <FocusCard
              key={team.id}
              focusId={`league-teams:${page.data!.league.id}:${team.id}`}
              accentColor={team.primaryColor ?? colors.primary}
              style={styles.logoCell}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={team.name}
                accessibilityHint="Open team"
                onPress={() => navigation.navigate('LeagueTeamDetail', { teamId: team.id, leagueId: page.data!.league.id })}
                style={styles.logoTarget}
              >
                <TeamLogo
                  teamId={team.id}
                  logoUrl={team.logoUrl}
                  teamName={team.name}
                  primaryColor={team.primaryColor}
                  size={104}
                  transparentBacking
                />
              </Pressable>
            </FocusCard>
          ))}
        </View>
      ) : <PageLoadState loading={false} error={null} noSeason retry={page.retry} />}
    </LeaguePageFrame>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.textPrimary, fontSize: 32, lineHeight: 38, fontWeight: '900', marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 14 },
  logoCell: { width: '47%' },
  logoTarget: { minHeight: 148, alignItems: 'center', justifyContent: 'center' },
});
