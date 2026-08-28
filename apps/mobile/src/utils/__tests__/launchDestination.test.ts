import { decideLaunchDestination } from '../launchDestination';

describe('decideLaunchDestination', () => {
  it('既定はホーム（設定オフ・通知タップなし）', () => {
    expect(
      decideLaunchDestination({ tappedLowStockNotification: false, launchCameraEnabled: false }),
    ).toBe('home');
  });

  it('「すぐ撮影」がオンなら撮影へ', () => {
    expect(
      decideLaunchDestination({ tappedLowStockNotification: false, launchCameraEnabled: true }),
    ).toBe('capture');
  });

  it('通知タップは設定より優先する（押したのと違う画面を開かない）', () => {
    expect(
      decideLaunchDestination({ tappedLowStockNotification: true, launchCameraEnabled: true }),
    ).toBe('low-stock');
  });

  it('通知タップだけなら買い物リストへ', () => {
    expect(
      decideLaunchDestination({ tappedLowStockNotification: true, launchCameraEnabled: false }),
    ).toBe('low-stock');
  });

  it('献立通知のタップは撮影より優先する', () => {
    expect(
      decideLaunchDestination({
        tappedLowStockNotification: false,
        tappedMenuNotification: true,
        launchCameraEnabled: true,
      }),
    ).toBe('menu');
  });

  it('献立通知のタップより残量通知のタップを優先する（決定性のためだけの順序）', () => {
    expect(
      decideLaunchDestination({
        tappedLowStockNotification: true,
        tappedMenuNotification: true,
        launchCameraEnabled: false,
      }),
    ).toBe('low-stock');
  });
});
