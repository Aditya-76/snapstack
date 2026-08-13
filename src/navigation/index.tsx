/**
 * Navigation: bottom tabs (Search / Ask / Reminders / Settings) inside a
 * native stack that hosts Detail and Activity screens.
 */

import React from 'react';
import { Text } from 'react-native';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityLogScreen } from '../screens/ActivityLogScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { DetailScreen } from '../screens/DetailScreen';
import { RemindersScreen } from '../screens/RemindersScreen';
import { SearchScreen } from '../screens/SearchScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { colors } from '../theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

// Screens take narrow structural prop types (only what they use) rather than
// the full React Navigation generics; cast at the registration boundary.
const asScreen = (c: unknown) => c as React.ComponentType;

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.surface,
    border: colors.border,
    primary: colors.accent,
    text: colors.textPrimary,
  },
};

const TAB_ICONS: Record<string, string> = {
  Search: '🔍',
  Ask: '💬',
  Reminders: '⏰',
  Settings: '⚙️',
};

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarIcon: ({ focused }) => (
          <Text style={{ fontSize: 18, opacity: focused ? 1 : 0.5 }}>{TAB_ICONS[route.name] ?? '•'}</Text>
        ),
      })}
    >
      <Tab.Screen name="Search" component={asScreen(SearchScreen)} />
      <Tab.Screen name="Ask" component={asScreen(ChatScreen)} />
      <Tab.Screen name="Reminders" component={asScreen(RemindersScreen)} />
      <Tab.Screen name="Settings" component={asScreen(SettingsScreen)} />
    </Tab.Navigator>
  );
}

export function AppNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
        }}
      >
        <Stack.Screen name="Home" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Detail" component={asScreen(DetailScreen)} options={{ title: 'Screenshot' }} />
        <Stack.Screen name="Activity" component={asScreen(ActivityLogScreen)} options={{ title: 'Activity log' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
