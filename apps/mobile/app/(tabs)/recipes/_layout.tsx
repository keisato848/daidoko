import { Stack } from 'expo-router';

import { Colors } from '../../../src/constants/theme';

export default function RecipesLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Colors.bg },
      }}
    />
  );
}
