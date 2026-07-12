/**
 * Web has no AdMob — this sibling keeps react-native-google-mobile-ads out of
 * web bundles. Metro resolves this for web; app-open-ad.admob.ts is used natively.
 */
import type { AppOpenAdProvider } from './app-open-ad.types';

export class AdMobAppOpenAdProvider implements AppOpenAdProvider {
  preload(): void {
    // no-op
  }
  isLoaded(): boolean {
    return false;
  }
  async show(): Promise<boolean> {
    return false;
  }
}
