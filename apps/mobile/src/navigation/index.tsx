import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
} from './types';
import GamePreviewScreen from '../screens/GamePreviewScreen';
import GameRecapScreen from '../screens/games/GameRecapScreen';
import HomeScreen from '../screens/HomeScreen';
import ProfileScreen from '../screens/ProfileScreen';
import EditProfileScreen from '../screens/EditProfileScreen';
import NotificationsFeedScreen from '../screens/NotificationsFeedScreen';
import NotificationSettingsScreen from '../screens/NotificationSettingsScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
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

import { supabase } from '../lib/supabase/client';
import colors from '../theme/colors';
import { getSurfacePalette } from '../theme/ui';
import { getTabBarLayout } from './layout';

const Tab = createBottomTabNavigator();
const ScheduleStack = createNativeStackNavigator<ScheduleStackParamList>();
const TeamStack = createNativeStackNavigator<TeamStackParamList>();
const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
const DiscoverStack = createNativeStackNavigator<DiscoverStackParamList>();
const StatsStack = createNativeStackNavigator<StatsStackParamList>();
const CaptainStack = createNativeStackNavigator<CaptainStackParamList>();

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

function AppTabBackground() {
  const { reduceTransparency } = useAccessibilityPreferences();
  const palette = getSurfacePalette(reduceTransparency);

  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={reduceTransparency
          ? [palette.elevated, palette.elevated]
          : ['rgba(8, 13, 24, 0.98)', 'rgba(11, 18, 33, 0.94)', 'rgba(8, 12, 22, 0.98)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={[`${colors.brandArena}20`, 'transparent']}
        start={{ x: 0.8, y: 0 }}
        end={{ x: 0.15, y: 1 }}
        style={styles.tabGlow}
      />
      <View style={styles.tabHairline} />
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

// Hook to check if user is a captain on any team
function useIsCaptain() {
  const { user } = useAuth();
  const [isCaptain, setIsCaptain] = React.useState(false);

  React.useEffect(() => {
    if (!user) {
      setIsCaptain(false);
      return;
    }

    supabase
      .from('team_rosters')
      .select('leadership_role')
      .eq('player_id', user.id)
      .eq('status', 'active')
      .in('leadership_role', ['captain', 'alternate_captain'])
      .limit(1)
      .then(({ data }) => {
        setIsCaptain((data ?? []).length > 0);
      });
  }, [user?.id]);

  return isCaptain;
}

export default function RootNavigation() {
  const { activeTheme } = useLeague();
  const { isGuest } = useAuth();
  const isCaptain = useIsCaptain();
  const insets = useSafeAreaInsets();
  const tabBarLayout = getTabBarLayout(insets.bottom);

  return (
    <View style={{ flex: 1 }}>
      {isGuest ? <AuthGuestBanner /> : null}
      <Tab.Navigator
      initialRouteName="Home"
      screenOptions={({ route }: any) => ({
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
        tabBarShowLabel: true,
        tabBarAccessibilityLabel: `${route.name} tab`,
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '800',
          marginTop: 0,
        },
        tabBarItemStyle: {
          minHeight: tabBarLayout.itemMinHeight,
          paddingVertical: 2,
        },
        tabBarStyle: {
          backgroundColor: 'transparent',
          borderTopWidth: 0,
          height: tabBarLayout.height,
          paddingTop: tabBarLayout.paddingTop,
          paddingBottom: tabBarLayout.paddingBottom,
          overflow: 'hidden',
        },
        tabBarBackground: () => <AppTabBackground />,
        tabBarIcon: ({ color, size, focused }: any) => {
          const iconSize = size + 1;

          if (route.name === 'Schedule') {
            return <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={iconSize} color={color} />;
          }

          if (route.name === 'Stats') {
            return <Ionicons name={focused ? 'stats-chart' : 'stats-chart-outline'} size={iconSize} color={color} />;
          }

          if (route.name === 'Home') {
            return <Ionicons name={focused ? 'home' : 'home-outline'} size={iconSize} color={color} />;
          }

          if (route.name === 'Discover') {
            return <Ionicons name={focused ? 'compass' : 'compass-outline'} size={iconSize} color={color} />;
          }

          if (route.name === 'Team') {
            return <MaterialCommunityIcons name="hockey-sticks" size={iconSize} color={color} />;
          }

          if (route.name === 'Captain') {
            return (
              <View>
                <MaterialCommunityIcons name="shield-crown-outline" size={iconSize} color={color} />
              </View>
            );
          }

          return <Ionicons name={focused ? 'person' : 'person-outline'} size={iconSize} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Schedule" component={ScheduleNavigator} />
      <Tab.Screen name="Discover" component={DiscoverNavigator} />
      <Tab.Screen name="Stats" component={StatsNavigator} />
      <Tab.Screen name="Team" component={TeamNavigator} />
      {isCaptain && (
        <Tab.Screen
          name="Captain"
          component={CaptainNavigator}
          options={{
            tabBarBadge: undefined,
            tabBarActiveTintColor: colors.brandGold,
          }}
        />
      )}
      <Tab.Screen name="Profile" component={ProfileNavigator} />
    </Tab.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
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
  tabGlow: {
    ...StyleSheet.absoluteFillObject,
    top: -12,
    left: '35%',
    bottom: '18%',
    borderRadius: 999,
  },
  tabHairline: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.glassStroke,
  },
});
