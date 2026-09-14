import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import AuthGuestBanner from '../components/AuthGuestBanner';
import LeagueSwitcher from '../components/LeagueSwitcher';
import { useAuth } from '../context/AuthContext';
import { useLeague } from '../context/LeagueContext';
import { useAccessibilityPreferences } from '../context/AccessibilityPreferencesContext';
import {
  ScheduleStackParamList,
  TeamStackParamList,
  ProfileStackParamList,
  DiscoverStackParamList,
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
import LeagueMarketplace from '../components/LeagueMarketplace';
import PlayerCardScreen from '../screens/PlayerCardScreen';

// New screens
import CareerStatsScreen from '../screens/stats/CareerStatsScreen';
import LeaderboardsScreen from '../screens/stats/LeaderboardsScreen';
import LeagueDiscoveryScreen from '../screens/discover/LeagueDiscoveryScreen';
import LeagueDetailScreen from '../screens/discover/LeagueDetailScreen';
import CaptainDashboardScreen from '../screens/captain/CaptainDashboardScreen';
import GameAvailabilityScreen from '../screens/captain/GameAvailabilityScreen';
import InvitePlayersScreen from '../screens/captain/InvitePlayersScreen';
import LineupNotesScreen from '../screens/captain/LineupNotesScreen';
import TeamChatScreen from '../screens/team/TeamChatScreen';
import TeamsDirectoryScreen from '../screens/league-pages/TeamsDirectoryScreen';
import PlayersDirectoryScreen from '../screens/league-pages/PlayersDirectoryScreen';
import PlayoffsDirectoryScreen from '../screens/league-pages/PlayoffsDirectoryScreen';
import NewsFeedScreen from '../screens/league-pages/NewsFeedScreen';
import NewsArticleScreen from '../screens/league-pages/NewsArticleScreen';
import LeagueHistoryScreen from '../screens/league-pages/LeagueHistoryScreen';
import GalleryAlbumsScreen from '../screens/league-pages/GalleryAlbumsScreen';
import GalleryAlbumScreen from '../screens/league-pages/GalleryAlbumScreen';

import colors from '../theme/colors';
import { getSurfacePalette } from '../theme/ui';
import MobileWebDock from './MobileWebDock';

const Tab = createBottomTabNavigator();
const ScheduleStack = createNativeStackNavigator<ScheduleStackParamList>();
const StandingsStack = createNativeStackNavigator<ScheduleStackParamList>();
const TeamStack = createNativeStackNavigator<TeamStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const DiscoverStack = createNativeStackNavigator<DiscoverStackParamList>();
const StatsStack = createNativeStackNavigator<StatsStackParamList>();
const CaptainStack = createNativeStackNavigator<CaptainStackParamList>();
const LeaguePagesStack = createNativeStackNavigator<LeaguePagesStackParamList>();

const LeagueTeamDetailComponent = TeamDetailScreen as unknown as React.ComponentType<NativeStackScreenProps<LeaguePagesStackParamList, 'LeagueTeamDetail'>>;
const LeaguePlayerCardComponent = PlayerCardScreen as unknown as React.ComponentType<NativeStackScreenProps<LeaguePagesStackParamList, 'LeaguePlayerCard'>>;
const LeagueGamePreviewComponent = GamePreviewScreen as unknown as React.ComponentType<NativeStackScreenProps<LeaguePagesStackParamList, 'LeagueGamePreview'>>;
const LeagueTeamChatComponent = TeamChatScreen as unknown as React.ComponentType<NativeStackScreenProps<LeaguePagesStackParamList, 'TeamChat'>>;

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
  'Venues',
  'About',
  'Contact',
] as const;

function AppHeaderBackground() {
  const { reduceTransparency } = useAccessibilityPreferences();
  const palette = getSurfacePalette(reduceTransparency);

  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={reduceTransparency
          ? [palette.elevated, palette.elevated]
          : ['rgba(8, 14, 27, 0.96)', 'rgba(10, 18, 33, 0.92)', 'rgba(6, 10, 20, 0.98)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[`${colors.brandRink}20`, 'transparent']}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.headerGlow}
      />
      <View style={styles.headerHairline} />
    </View>
  );
}

function ScheduleNavigator() {
  return (
    <ScheduleStack.Navigator screenOptions={{ headerShown: false }}>
      <ScheduleStack.Screen name="ScheduleList" component={ScheduleScreen} />
      <ScheduleStack.Screen name="GamePreview" component={GamePreviewScreen} />
      <ScheduleStack.Screen name="GameRecap" component={GameRecapScreen} />
    </ScheduleStack.Navigator>
  );
}

function StandingsNavigator() {
  return (
    <StandingsStack.Navigator screenOptions={{ headerShown: false }}>
      <StandingsStack.Screen name="ScheduleList" component={StandingsScreen} />
      <StandingsStack.Screen name="GamePreview" component={GamePreviewScreen} />
      <StandingsStack.Screen name="GameRecap" component={GameRecapScreen} />
    </StandingsStack.Navigator>
  );
}

function TeamNavigator() {
  return (
    <TeamStack.Navigator screenOptions={{ headerShown: false }}>
      <TeamStack.Screen name="TeamList" component={TeamScreen} />
      <TeamStack.Screen name="TeamDetail" component={TeamDetailScreen} />
      <TeamStack.Screen name="PlayerCard" component={PlayerCardScreen} />
      <TeamStack.Screen name="TeamChat" component={TeamChatScreen} />
    </TeamStack.Navigator>
  );
}

function ProfileNavigator() {
  return (
    <ProfileStack.Navigator screenOptions={{ headerShown: false }}>
      <ProfileStack.Screen name="ProfileMain" component={ProfileScreen} />
      <ProfileStack.Screen name="EditProfile" component={EditProfileScreen} />
      <ProfileStack.Screen name="NotificationsFeed" component={NotificationsFeedScreen} />
      <ProfileStack.Screen name="NotificationSettings" component={NotificationSettingsScreen} />
      <ProfileStack.Screen name="LeagueMarketplace" component={LeagueMarketplace} />
      <ProfileStack.Screen name="PlayerCard" component={PlayerCardScreen} />
      <ProfileStack.Screen name="CareerStats" component={CareerStatsScreen} />
    </ProfileStack.Navigator>
  );
}

function DiscoverNavigator() {
  return (
    <DiscoverStack.Navigator screenOptions={{ headerShown: false }}>
      <DiscoverStack.Screen name="DiscoverMain" component={LeagueDiscoveryScreen} />
      <DiscoverStack.Screen name="LeagueDetail" component={LeagueDetailScreen} />
    </DiscoverStack.Navigator>
  );
}

function StatsNavigator() {
  return (
    <StatsStack.Navigator screenOptions={{ headerShown: false }}>
      <StatsStack.Screen name="StatsMain" component={StatsScreen} />
      <StatsStack.Screen name="Leaderboards" component={LeaderboardsScreen} />
      <StatsStack.Screen name="CareerStats" component={CareerStatsScreen} />
    </StatsStack.Navigator>
  );
}

function CaptainNavigator() {
  return (
    <CaptainStack.Navigator screenOptions={{ headerShown: false }}>
      <CaptainStack.Screen name="CaptainDashboard" component={CaptainDashboardScreen} />
      <CaptainStack.Screen name="GameAvailability" component={GameAvailabilityScreen} />
      <CaptainStack.Screen name="InvitePlayers" component={InvitePlayersScreen} />
      <CaptainStack.Screen name="LineupNotes" component={LineupNotesScreen} />
      <CaptainStack.Screen name="TeamChat" component={TeamChatScreen} />
    </CaptainStack.Navigator>
  );
}

function LeaguePagesNavigator() {
  return (
    <LeaguePagesStack.Navigator screenOptions={{ headerShown: false }}>
      <LeaguePagesStack.Screen name="TeamsDirectory" component={TeamsDirectoryScreen} />
      <LeaguePagesStack.Screen name="PlayersDirectory" component={PlayersDirectoryScreen} />
      <LeaguePagesStack.Screen name="PlayoffsDirectory" component={PlayoffsDirectoryScreen} />
      <LeaguePagesStack.Screen name="NewsFeed" component={NewsFeedScreen} />
      <LeaguePagesStack.Screen name="NewsArticle" component={NewsArticleScreen} />
      <LeaguePagesStack.Screen name="LeagueHistory" component={LeagueHistoryScreen} />
      <LeaguePagesStack.Screen name="GalleryAlbums" component={GalleryAlbumsScreen} />
      <LeaguePagesStack.Screen name="GalleryAlbum" component={GalleryAlbumScreen} />
      <LeaguePagesStack.Screen name="LeagueTeamDetail" component={LeagueTeamDetailComponent} />
      <LeaguePagesStack.Screen name="LeaguePlayerCard" component={LeaguePlayerCardComponent} />
      <LeaguePagesStack.Screen name="LeagueGamePreview" component={LeagueGamePreviewComponent} />
      <LeaguePagesStack.Screen name="TeamChat" component={LeagueTeamChatComponent} />
    </LeaguePagesStack.Navigator>
  );
}

export default function RootNavigation() {
  const { activeTheme } = useLeague();
  const { isGuest } = useAuth();

  return (
    <View style={[styles.root, { backgroundColor: activeTheme.backgroundColor || colors.bgBase }]}>
      {isGuest ? <AuthGuestBanner /> : null}
      <Tab.Navigator
      initialRouteName="Home"
      tabBar={(props) => <MobileWebDock {...props} />}
      screenOptions={() => ({
        headerShown: true,
        headerTitleAlign: 'center',
        headerStyle: {
          backgroundColor: 'transparent',
        },
        headerShadowVisible: false,
        headerBackground: () => <AppHeaderBackground />,
        headerTitle: () => <LeagueSwitcher />,
        sceneStyle: {
          backgroundColor: activeTheme.backgroundColor,
        },
        tabBarHideOnKeyboard: true,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Standings" component={StandingsNavigator} />
      <Tab.Screen name="Schedule" component={ScheduleNavigator} />
      <Tab.Screen name="Discover" component={DiscoverNavigator} />
      <Tab.Screen name="Stats" component={StatsNavigator} />
      <Tab.Screen name="Team" component={TeamNavigator} />
      <Tab.Screen name="Captain" component={CaptainNavigator} />
      <Tab.Screen name="Profile" component={ProfileNavigator} />
      <Tab.Screen name="LeaguePages" component={LeaguePagesNavigator} options={{ tabBarButton: () => null }} />
    </Tab.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  headerGlow: {
    ...StyleSheet.absoluteFillObject,
    top: -32,
    left: -28,
    right: '36%',
    bottom: '10%',
    borderRadius: 999,
  },
  headerHairline: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.glassStroke,
  },
});
