import { describe, it, expect } from 'vitest';
import { formatTime } from './TimeFormatter';

describe('formatTime', () => {
  it('formats zero', () => {
    expect(formatTime(0)).toBe('00:00.000');
  });

  it('formats seconds with milliseconds', () => {
    expect(formatTime(1250)).toBe('00:01.250');
  });

  it('formats minutes', () => {
    expect(formatTime(65000)).toBe('01:05.000');
  });

  it('clamps negatives', () => {
    expect(formatTime(-100)).toBe('00:00.000');
  });

  it('floors milliseconds', () => {
    expect(formatTime(1000.999)).toBe('00:01.000');
  });

  it('returns zero formatting for non-finite input', () => {
    expect(formatTime(NaN)).toBe('00:00.000');
    expect(formatTime(Infinity)).toBe('00:00.000');
    expect(formatTime(-Infinity)).toBe('00:00.000');
  });
});
