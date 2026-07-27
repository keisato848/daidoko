jest.mock('../../db/client', () => ({ isNativePlatform: true, getDb: jest.fn() }));
jest.mock('../app-meta.service', () => ({ getAppMeta: jest.fn(), setAppMeta: jest.fn() }));
jest.mock('../cooking-log.service', () => ({ getCookingLogCount: jest.fn() }));

import * as StoreReview from 'expo-store-review';

import { getAppMeta, setAppMeta } from '../app-meta.service';
import { getCookingLogCount } from '../cooking-log.service';
import { maybeRequestStoreReview } from '../review-request.service';

const mockGetAppMeta = getAppMeta as jest.MockedFunction<typeof getAppMeta>;
const mockCount = getCookingLogCount as jest.MockedFunction<typeof getCookingLogCount>;
const mockAvailable = StoreReview.isAvailableAsync as jest.Mock;
const mockRequest = StoreReview.requestReview as jest.Mock;

describe('maybeRequestStoreReview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAppMeta.mockResolvedValue(null);
    mockCount.mockResolvedValue(2);
    mockAvailable.mockResolvedValue(true);
  });

  it('requests a review and records the day on the happy path', async () => {
    expect(await maybeRequestStoreReview()).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(setAppMeta).toHaveBeenCalledWith(
      'store_review_requested_at',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    );
  });

  it('asks only once per install', async () => {
    mockGetAppMeta.mockResolvedValue('2026-07-01T00:00:00.000Z');
    expect(await maybeRequestStoreReview()).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('waits until the user has enough cooking logs', async () => {
    mockCount.mockResolvedValue(1);
    expect(await maybeRequestStoreReview()).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('skips when the platform review dialog is unavailable', async () => {
    mockAvailable.mockResolvedValue(false);
    expect(await maybeRequestStoreReview()).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(setAppMeta).not.toHaveBeenCalled();
  });

  it('never throws even when the native call fails', async () => {
    mockRequest.mockRejectedValue(new Error('native boom'));
    expect(await maybeRequestStoreReview()).toBe(false);
    expect(setAppMeta).not.toHaveBeenCalled();
  });
});
