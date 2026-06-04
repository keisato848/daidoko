import { isSampleDataEnabled, shouldHideSeedCookingLog, shouldHideSeedRecipe } from '../sampleData';

const originalEnableSampleData = process.env.EXPO_PUBLIC_ENABLE_SAMPLE_DATA;
const originalNodeEnv = process.env.NODE_ENV;
const originalJestWorkerId = process.env.JEST_WORKER_ID;

describe('sample data visibility', () => {
  afterEach(() => {
    process.env.EXPO_PUBLIC_ENABLE_SAMPLE_DATA = originalEnableSampleData;
    process.env.NODE_ENV = originalNodeEnv;
    process.env.JEST_WORKER_ID = originalJestWorkerId;
  });

  it('is disabled by default outside test mode', () => {
    delete process.env.EXPO_PUBLIC_ENABLE_SAMPLE_DATA;
    process.env.NODE_ENV = 'production';
    delete process.env.JEST_WORKER_ID;

    expect(isSampleDataEnabled()).toBe(false);
    expect(shouldHideSeedRecipe('recipe-1')).toBe(true);
    expect(shouldHideSeedCookingLog('log-1', 'recipe-1')).toBe(true);
  });

  it('can be enabled explicitly for emulator and device tests', () => {
    process.env.EXPO_PUBLIC_ENABLE_SAMPLE_DATA = '1';
    process.env.NODE_ENV = 'production';
    delete process.env.JEST_WORKER_ID;

    expect(isSampleDataEnabled()).toBe(true);
    expect(shouldHideSeedRecipe('recipe-1')).toBe(false);
    expect(shouldHideSeedCookingLog('log-1', 'recipe-1')).toBe(false);
  });

  it('stays enabled in jest mode without the explicit flag', () => {
    delete process.env.EXPO_PUBLIC_ENABLE_SAMPLE_DATA;
    process.env.NODE_ENV = 'test';
    process.env.JEST_WORKER_ID = '1';

    expect(isSampleDataEnabled()).toBe(true);
    expect(shouldHideSeedRecipe('recipe-1')).toBe(false);
  });

  it('does not hide user-created records', () => {
    delete process.env.EXPO_PUBLIC_ENABLE_SAMPLE_DATA;
    process.env.NODE_ENV = 'production';
    delete process.env.JEST_WORKER_ID;

    expect(shouldHideSeedRecipe('recipe-user-created')).toBe(false);
    expect(shouldHideSeedCookingLog('log-user-created', 'recipe-user-created')).toBe(false);
  });
});
