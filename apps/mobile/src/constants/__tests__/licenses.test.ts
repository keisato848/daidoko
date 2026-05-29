import { LICENSE_ITEMS } from '../licenses';

describe('LICENSE_ITEMS', () => {
  it('contains visible license metadata for every listed package', () => {
    expect(LICENSE_ITEMS.length).toBeGreaterThan(10);
    for (const item of LICENSE_ITEMS) {
      expect(item.packageName).toBeTruthy();
      expect(item.purpose).toBeTruthy();
      expect(item.license).toBeTruthy();
    }
  });
});
