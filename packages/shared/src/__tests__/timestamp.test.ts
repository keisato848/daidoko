import { describe, it, expect } from 'vitest';
import { captureTimestamp, elapsedMs } from '../bridge/timestamp';

describe('captureTimestamp', () => {
  it('should return wallTime as ISO 8601 string', () => {
    const { wallTime } = captureTimestamp();
    expect(wallTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should return perfMark as a number', () => {
    const { perfMark } = captureTimestamp();
    expect(typeof perfMark).toBe('number');
    expect(perfMark).toBeGreaterThan(0);
  });
});

describe('elapsedMs', () => {
  it('should calculate elapsed time between two marks', () => {
    const result = elapsedMs(100.0, 250.5);
    expect(result).toBe(150.5);
  });

  it('should round to 2 decimal places', () => {
    const result = elapsedMs(0, 100.1234);
    expect(result).toBe(100.12);
  });

  it('should return 0 for same marks', () => {
    const result = elapsedMs(100, 100);
    expect(result).toBe(0);
  });
});
