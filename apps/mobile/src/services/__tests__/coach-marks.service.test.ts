jest.mock('../../db/client', () => ({ isNativePlatform: true }));
jest.mock('../app-meta.service', () => ({ getAppMeta: jest.fn(), setAppMeta: jest.fn() }));

import { getAppMeta, setAppMeta } from '../app-meta.service';
import {
  COACH_MARK_SCREENS,
  markCoachMarksSeen,
  resetCoachMarks,
  shouldShowCoachMarks,
} from '../coach-marks.service';

const mockGetAppMeta = getAppMeta as jest.MockedFunction<typeof getAppMeta>;
const mockSetAppMeta = setAppMeta as jest.MockedFunction<typeof setAppMeta>;

describe('coach-marks.service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows marks for a screen never seen', async () => {
    mockGetAppMeta.mockResolvedValue(null);
    expect(await shouldShowCoachMarks('home')).toBe(true);
  });

  it('hides marks once seen', async () => {
    mockGetAppMeta.mockResolvedValue('1');
    expect(await shouldShowCoachMarks('home')).toBe(false);
  });

  it('marks a screen as seen', async () => {
    await markCoachMarksSeen('pantry');
    expect(mockSetAppMeta).toHaveBeenCalledWith('coach_marks_seen:pantry', '1');
  });

  it('reset re-arms every screen', async () => {
    await resetCoachMarks();
    expect(mockSetAppMeta).toHaveBeenCalledTimes(COACH_MARK_SCREENS.length);
    for (const screen of COACH_MARK_SCREENS) {
      expect(mockSetAppMeta).toHaveBeenCalledWith(`coach_marks_seen:${screen}`, '0');
    }
    // リセット値 '0' は SEEN ('1') ではないので再表示される
    mockGetAppMeta.mockResolvedValue('0');
    expect(await shouldShowCoachMarks('recipes')).toBe(true);
  });
});
