/**
 * App-wide configuration
 * SERVER_BASE_URL: Hono API server endpoint
 */
import { Platform } from 'react-native';

const isWeb = Platform.OS === 'web';

// On web (Expo Web), the server runs on localhost:3000
// On native, use your local IP or staging URL
export const SERVER_BASE_URL =
  process.env['EXPO_PUBLIC_SERVER_URL'] ??
  (isWeb ? 'http://localhost:3000' : 'http://localhost:3000');

export const API_V1 = `${SERVER_BASE_URL}/api/v1`;
