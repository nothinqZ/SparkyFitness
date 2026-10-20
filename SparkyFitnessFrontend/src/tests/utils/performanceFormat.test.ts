import {
  convertDistance,
  formatClockMinutes,
  formatDuration,
  formatPace,
} from '@/utils/performanceFormat';

describe('performanceFormat', () => {
  it('formats durations with and without hours', () => {
    expect(formatDuration(1200)).toBe('20:00');
    expect(formatDuration(2502)).toBe('41:42');
    expect(formatDuration(11509)).toBe('3:11:49');
    expect(formatDuration(null)).toBe('–');
  });

  it('formats pace per km and per mile', () => {
    expect(formatPace(300)).toBe('5:00 /km');
    // 300 s/km × 1.609344 = 482.8 s/mi
    expect(formatPace(300, 'miles')).toBe('8:03 /mi');
    expect(formatPace(null)).toBe('–');
  });

  it('converts distances and clock minutes', () => {
    expect(convertDistance(1.609344, 'miles')).toBeCloseTo(1);
    expect(convertDistance(5, 'km')).toBe(5);
    expect(formatClockMinutes(23 * 60 + 5)).toBe('23:05');
    expect(formatClockMinutes(-30)).toBe('23:30');
  });
});
