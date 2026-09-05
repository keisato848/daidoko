jest.mock('../../db/client', () => ({ isNativePlatform: true, getDb: jest.fn() }));
jest.mock('../app-meta.service', () => ({ getAppMeta: jest.fn(), setAppMeta: jest.fn() }));
jest.mock('../cooking-log.service', () => ({ getCookingLogCount: jest.fn() }));

import { Linking, Platform } from 'react-native';
import * as StoreReview from 'expo-store-review';

import { getAppMeta, setAppMeta } from '../app-meta.service';
import { getCookingLogCount } from '../cooking-log.service';
import {
  MIN_COOKING_LOGS_FOR_REVIEW,
  maybeRequestStoreReview,
  openStoreReviewPage,
  storeReviewUrls,
} from '../review-request.service';

const mockGetAppMeta = getAppMeta as jest.MockedFunction<typeof getAppMeta>;
const mockCount = getCookingLogCount as jest.MockedFunction<typeof getCookingLogCount>;
const mockAvailable = StoreReview.isAvailableAsync as jest.Mock;
const mockRequest = StoreReview.requestReview as jest.Mock;

describe('maybeRequestStoreReview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAppMeta.mockResolvedValue(null);
    mockCount.mockResolvedValue(MIN_COOKING_LOGS_FOR_REVIEW);
    mockAvailable.mockResolvedValue(true);
  });

  it('requests a review and records the day on the happy path', async () => {
    expect(await maybeRequestStoreReview('cooking-log')).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(setAppMeta).toHaveBeenCalledWith(
      'store_review_requested_at',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });

  it('asks only once per install, whichever moment fires first', async () => {
    mockGetAppMeta.mockResolvedValue('2026-07-01T00:00:00.000Z');
    expect(await maybeRequestStoreReview('cooking-log')).toBe(false);
    expect(await maybeRequestStoreReview('ai-recipe')).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('fires on the very first cooking log (the first success moment)', async () => {
    mockCount.mockResolvedValue(1);
    expect(await maybeRequestStoreReview('cooking-log')).toBe(true);
  });

  it('waits while there is no cooking log at all', async () => {
    mockCount.mockResolvedValue(0);
    expect(await maybeRequestStoreReview('cooking-log')).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('does not require any cooking log when an AI recipe was just saved', async () => {
    mockCount.mockResolvedValue(0);
    expect(await maybeRequestStoreReview('ai-recipe')).toBe(true);
    expect(mockCount).not.toHaveBeenCalled();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('skips when the platform review dialog is unavailable', async () => {
    mockAvailable.mockResolvedValue(false);
    expect(await maybeRequestStoreReview('ai-recipe')).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(setAppMeta).not.toHaveBeenCalled();
  });

  it('never throws even when the native call fails', async () => {
    mockRequest.mockRejectedValue(new Error('native boom'));
    expect(await maybeRequestStoreReview('cooking-log')).toBe(false);
    expect(setAppMeta).not.toHaveBeenCalled();
  });
});

describe('storeReviewUrls', () => {
  it('points at this app on both stores', () => {
    const [iosApp, iosWeb] = storeReviewUrls('ios');
    expect(iosApp).toContain('id6800964382');
    expect(iosApp).toContain('action=write-review');
    expect(iosWeb).toMatch(/^https:\/\/apps\.apple\.com\//);
    const [androidApp, androidWeb] = storeReviewUrls('android');
    expect(androidApp).toBe('market://details?id=com.daidoko.app');
    expect(androidWeb).toBe('https://play.google.com/store/apps/details?id=com.daidoko.app');
  });
});

describe('openStoreReviewPage', () => {
  const openURL = jest.spyOn(Linking, 'openURL');
  const os = Platform.OS;

  beforeEach(() => {
    openURL.mockReset();
  });
  afterAll(() => {
    Platform.OS = os;
  });

  it('opens the store app first', async () => {
    Platform.OS = 'ios';
    openURL.mockResolvedValue(true);
    expect(await openStoreReviewPage()).toBe(true);
    expect(openURL).toHaveBeenCalledTimes(1);
    expect(openURL).toHaveBeenCalledWith(storeReviewUrls('ios')[0]);
  });

  it('falls back to the web product page when the store app cannot open', async () => {
    Platform.OS = 'android';
    openURL.mockRejectedValueOnce(new Error('no handler')).mockResolvedValueOnce(true);
    expect(await openStoreReviewPage()).toBe(true);
    expect(openURL).toHaveBeenNthCalledWith(2, storeReviewUrls('android')[1]);
  });

  it('does nothing outside iOS/Android (no store to open)', async () => {
    Platform.OS = 'web';
    expect(await openStoreReviewPage()).toBe(false);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('returns false when neither URL opens', async () => {
    Platform.OS = 'android';
    openURL.mockRejectedValue(new Error('no handler'));
    expect(await openStoreReviewPage()).toBe(false);
  });
});
