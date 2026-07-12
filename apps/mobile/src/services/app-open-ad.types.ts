/** App Open ad provider boundary (native AdMob / web no-op). */
export interface AppOpenAdProvider {
  /** Begin loading an ad in the background (idempotent while a load is fresh). */
  preload(): void;
  /** Whether a non-expired ad is ready to show right now. */
  isLoaded(): boolean;
  /** Show the loaded ad. Resolves when it is closed; false if nothing was shown. */
  show(): Promise<boolean>;
}
