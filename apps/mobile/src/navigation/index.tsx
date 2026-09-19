import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '../context/AuthContext';
import { FocusPauseProvider } from '../context/FocusPauseContext';
import { useLeague } from '../context/LeagueContext';
import {
  ScheduleStackParamList,
  TeamStackParamList,
  ProfileStackParamList,
  StatsStackParamList,
  CaptainStackParamList,
  LeaguePagesStackParamList,
} from './types';
import GamePreviewScreen from '../screens/GamePreviewScreen';
import GameRecapScreen from '../screens/games/GameRecapScreen';
import HomeScreen from '../screens/HomeScreen';
import ProfileScreen from '../screens/ProfileScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import NotificationsFeedScreen from '../screens/NotificationsFeedScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import StandingsScreen from '../screens/StandingsScreen';
import StatsScreen from '../screens/StatsScreen';
import TeamScreen from '../screens/TeamScreen';
import TeamDetailScreen from '../screens/TeamScreen/TeamDetailScreen';
import PlayerCardScreen from '../screens/PlayerCardScreen';
import CutIceTitle from '../components/CutIceTitle';
import { cutIceScreenLayout } from './CutIceScreenBoundary';

// New screens
import CareerStatsScreen from '../screens/stats/CareerStatsScreen';
import LeaderboardsScreen from '../screens/stats/LeaderboardsScreen';
import CaptainDashboardScreen from '../screens/captain/CaptainDashboardScreen';
import GameAvailabilityScreen from '../screens/captain/GameAvailabilityScreen';
import InvitePlayersScreen from '../screens/captain/InvitePlayersScreen';
import LineupNotesScreen from '../screens/captain/LineupNotesScreen';
import TeamsDirectoryScreen from '../screens/league-pages/TeamsDirectoryScreen';
import PlayersDirectoryScreen from '../screens/league-pages/PlayersDirectoryScreen';
import PlayoffsDirectoryScreen from '../screens/league-pages/PlayoffsDirectoryScreen';
import NewsFeedScreen from '../screens/league-pages/NewsFeedScreen';
import NewsArticleScreen from '../screens/league-pages/NewsArticleScreen';
import LeagueHistoryScreen from '../screens/league-pages/LeagueHistoryScreen';
import GalleryAlbumsScreen from '../screens/league-pages/GalleryAlbumsScreen';
import GalleryAlbumScreen from '../screens/league-pages/GalleryAlbumScreen';
import EventsScreen from '../screens/league-pages/EventsScreen';
import ContactScreen from '../screens/league-pages/ContactScreen';

import colors from '../theme/colors';
import MobileWebDock from './MobileWebDock';
import GuestBannerLayout from './GuestBannerLayout';
import { MobileShellDataProvider } from './MobileShellDataContext';

const Tab = createBottomTabNavigator();
const ScheduleStack = createNativeStackNavigator<ScheduleStackParamList>();
const StandingsStack = createNativeStackNavigator<ScheduleStackParamList>();
const TeamStack = createNativeStackNavigator<TeamStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const StatsStack = createNativeStackNavigator<StatsStackParamList>();
const CaptainStack = createNativeStackNavigator<CaptainStackParamList>();
const LeaguePagesStack = createNativeStackNavigator<LeaguePagesStackParamList>();

const LeagueTeamDetailComponent = TeamDetailScreen as unknown as React.ComponentType<NativeStackScreenProps<LeaguePagesStackParamList, 'LeagueTeamDetail'>>;
const LeaguePlayerCardComponent = PlayerCardScreen as unknown as React.ComponentType<NativeStackScreenProps<LeaguePagesStackParamList, 'LeaguePlayerCard'>>;
const LeagueGamePreviewComponent = GamePreviewScreen as unknown as React.ComponentType<NativeStackScreenProps<LeaguePagesStackParamList, 'LeagueGamePreview'>>;

export const VISIBLE_DOCK_CONTROLS = ['Standings', 'Schedule', 'Team', 'Stats', 'More'] as const;

// Mirrors the public page inventory in the current league-sites FloatingDock.
// Visibility, season phase and authentication are applied at runtime.
export const PUBLIC_MORE_PAGE_LABELS = [
  'Teams',
  'Players',
  'Playoffs',
  'News',
  'History',
  'Gallery',
  'Events',
  'Contact',
] as const;

function cutIceOptions(title: string) {
  return {
    headerShown: true,
    header: ({ navigation, back }: { navigation: { goBack: () => void }; back?: unknown }) => (
      <CutIceTitle title={title} onBack={back ? navigation.goBack : undefined} />
    ),
  };
}

function ScheduleNavigator() {
  return (
    <ScheduleStack.Navigator screenLayout={cutIceScreenLayout}>
      <ScheduleStack.Screen name="ScheduleList" component={ScheduleScreen} options={cutIceOptions('Schedule')} />
      <ScheduleStack.Screen name="GamePreview" component={GamePreviewScreen} options={cutIceOptions('Game Preview')} />
      <ScheduleStack.Screen name="GameRecap" component={GameRecapScreen} options={cutIceOptions('Game Recap')} />
    </ScheduleStack.Navigator>
  );
}

function StandingsNavigator() {
  return (
    <StandingsStack.Navigator screenLayout={cutIceScreenLayout}>
      <StandingsStack.Screen name="ScheduleList" component={StandingsScreen} options={cutIceOptions('Standings')} />
      <StandingsStack.Screen name="GamePreview" component={GamePreviewScreen} options={cutIceOptions('Game Preview')} />
      <StandingsStack.Screen name="GameRecap" component={GameRecapScreen} options={cutIceOptions('Game Recap')} />
    </StandingsStack.Navigator>
  );
}

function TeamNavigator() {
  return (
    <TeamStack.Navigator screenLayout={cutIceScreenLayout}>
      <TeamStack.Screen name="TeamList" component={TeamScreen} options={cutIceOptions('Teams')} />
      <TeamStack.Screen name="TeamDetail" component={TeamDetailScreen} options={{ headerShown: false }} />
      <TeamStack.Screen name="PlayerCard" component={PlayerCardScreen} options={cutIceOptions('Player Profile')} />
    </TeamStack.Navigator>
  );
}

function ProfileNavigator() {
  return (
    <ProfileStack.Navigator screenLayout={cutIceScreenLayout}>
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} options={cutIceOptions('My Profile')} />
      <ProfileStack.Screen name="EditProfile" component={EditProfileScreen} options={cutIceOptions('Edit Profile')} />
      <ProfileStack.Screen name="NotificationsFeed" component={NotificationsFeedScreen} options={cutIceOptions('Notifications')} />
      <ProfileStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} options={cutIceOptions('Notification Settings')} />
      <ProfileStack.Screen name="PlayerCard" component={PlayerCardScreen} options={cutIceOptions('Player Profile')} />
      <ProfileStack.Screen name="CareerStats" component={CareerStatsScreen} options={cutIceOptions('Career Stats')} />
    </ProfileStack.Navigator>
  );
}

function StatsNavigator() {
  return (
    <StatsStack.Navigator screenLayout={cutIceScreenLayout}>
      <StatsStack.Screen name="StatsMain" component={StatsScreen} options={cutIceOptions('Stats')} />
      <StatsStack.Screen name="Leaderboards" component={LeaderboardsScreen} options={cutIceOptions('Leaderboards')} />
      <StatsStack.Screen name="CareerStats" component={CareerStatsScreen} options={cutIceOptions('Career Stats')} />
    </StatsStack.Navigator>
  );
}

function CaptainNavigator() {
  return (
    <CaptainStack.Navigator screenLayout={cutIceScreenLayout}>
      <CaptainStack.Screen name="CaptainDashboard" component={CaptainDashboardScreen} options={cutIceOptions('Captain Dashboard')} />
      <CaptainStack.Screen name="GameAvailability" component={GameAvailabilityScreen} options={cutIceOptions('Game Availability')} />
      <CaptainStack.Screen name="InvitePlayers" component={InvitePlayersScreen} options={cutIceOptions('Invite Players')} />
      <CaptainStack.Screen name="LineupNotes" component={LineupNotesScreen} options={cutIceOptions('Lineup Notes')} />
    </CaptainStack.Navigator>
  );
}

function LeaguePagesNavigator() {
  return (
    <LeaguePagesStack.Navigator screenLayout={cutIceScreenLayout}>
      <LeaguePagesStack.Screen name="TeamsDirectory" component={TeamsDirectoryScreen} options={cutIceOptions('Teams')} />
      <LeaguePagesStack.Screen name="PlayersDirectory" component={PlayersDirectoryScreen} options={cutIceOptions('Players')} />
      <LeaguePagesStack.Screen name="PlayoffsDirectory" component={PlayoffsDirectoryScreen} options={cutIceOptions('Playoffs')} />
      <LeaguePagesStack.Screen name="NewsFeed" component={NewsFeedScreen} options={cutIceOptions('News')} />
      <LeaguePagesStack.Screen name="NewsArticle" component={NewsArticleScreen} options={cutIceOptions('News Article')} />
      <LeaguePagesStack.Screen name="LeagueHistory" component={LeagueHistoryScreen} options={cutIceOptions('League History')} />
      <LeaguePagesStack.Screen name="GalleryAlbums" component={GalleryAlbumsScreen} options={cutIceOptions('Gallery')} />
      <LeaguePagesStack.Screen name="GalleryAlbum" component={GalleryAlbumScreen} options={cutIceOptions('Gallery Album')} />
      <LeaguePagesStack.Screen name="Events" component={EventsScreen} options={cutIceOptions('Events')} />
      <LeaguePagesStack.Screen name="Contact" component={ContactScreen} options={cutIceOptions('Contact')} />
      <LeaguePagesStack.Screen name="LeagueTeamDetail" component={LeagueTeamDetailComponent} options={{ headerShown: false }} />
      <LeaguePagesStack.Screen name="LeaguePlayerCard" component={LeaguePlayerCardComponent} options={cutIceOptions('Player Profile')} />
      <LeaguePagesStack.Screen name="LeagueGamePreview" component={LeagueGamePreviewComponent} options={cutIceOptions('Game Preview')} />
    </LeaguePagesStack.Navigator>
  );
}

export default function RootNavigation() {
  const { activeLeague, activeTheme } = useLeague();
  const { isGuest, user } = useAuth();

  return (
    <FocusPauseProvider>
      <GuestBannerLayout isGuest={isGuest}>
        <MobileShellDataProvider leagueId={activeLeague?.id ?? null} leaguePrimary={activeTheme.primaryColor} userId={user?.id ?? null}>
          <View style={[styles.root, { backgroundColor: activeTheme.backgroundColor || colors.bgBase }]}>
            <Tab.Navigator
              initialRouteName="Home"
              tabBar={(props) => <MobileWebDock {...props} />}
              screenOptions={() => ({
                headerShown: false,
                sceneStyle: { backgroundColor: activeTheme.backgroundColor },
                tabBarHideOnKeyboard: true,
              })}
            >
              <Tab.Screen name="Home" component={HomeScreen} />
              <Tab.Screen name="Standings" component={StandingsNavigator} />
              <Tab.Screen name="Schedule" component={ScheduleNavigator} />
              <Tab.Screen name="Stats" component={StatsNavigator} />
              <Tab.Screen name="Team" component={TeamNavigator} />
              <Tab.Screen name="Captain" component={CaptainNavigator} />
              <Tab.Screen name="Profile" component={ProfileNavigator} />
              <Tab.Screen name="LeaguePages" component={LeaguePagesNavigator} options={{ tabBarButton: () => null }} />
            </Tab.Navigator>
          </View>
        </MobileShellDataProvider>
      </GuestBannerLayout>
    </FocusPauseProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
});
