/**
 * 個人/家族の切り替え（設計 §5-2）。
 *
 * 固定したいこと:
 * - **グループに入っていないあいだは何も描かない**（使わない人の画面を変えない）
 * - 入っていれば状態が読め、タップで反転を通知する
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { SharedToggle } from '../SharedToggle';
import { t } from '../../i18n';
import { useSyncStore } from '../../stores/sync.store';

beforeEach(() => {
  useSyncStore.getState().resetForTesting();
});

describe('SharedToggle', () => {
  it('家族グループに入っていなければ何も出さない', () => {
    render(<SharedToggle shared onToggle={jest.fn()} />);

    expect(screen.queryByText(t('pantry.shared.onBadge'))).toBeNull();
    expect(screen.queryByText(t('pantry.shared.offBadge'))).toBeNull();
  });

  it('入っていれば共有中と分かる', () => {
    useSyncStore.getState().setJoined(true);

    render(<SharedToggle shared onToggle={jest.fn()} />);

    expect(screen.getByText(t('pantry.shared.onBadge'))).toBeTruthy();
    expect(screen.getByLabelText(t('pantry.shared.onLabel'))).toBeTruthy();
  });

  it('自分だけの品目はそう分かる', () => {
    useSyncStore.getState().setJoined(true);

    render(<SharedToggle shared={false} onToggle={jest.fn()} />);

    expect(screen.getByText(t('pantry.shared.offBadge'))).toBeTruthy();
  });

  it('タップで反転を伝える', () => {
    useSyncStore.getState().setJoined(true);
    const onToggle = jest.fn();

    render(<SharedToggle shared onToggle={onToggle} />);
    fireEvent.press(screen.getByLabelText(t('pantry.shared.onLabel')));

    expect(onToggle).toHaveBeenCalledWith(false);
  });
});
