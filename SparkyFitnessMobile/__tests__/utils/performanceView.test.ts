import {
  acwrTone,
  averagePace,
  baselineTone,
  distanceFromKm,
  formatDurationSeconds,
  formatPacePerUnit,
} from '../../src/utils/performanceView';

describe('performanceView', () => {
  it('formats durations and paces', () => {
    expect(formatDurationSeconds(1200)).toBe('20:00');
    expect(formatDurationSeconds(11509)).toBe('3:11:49');
    expect(formatDurationSeconds(null)).toBe('–');
    expect(formatPacePerUnit(300, 'km')).toBe('5:00 /km');
    expect(formatPacePerUnit(300, 'miles')).toBe('8:03 /mi');
  });

  it('converts distances and averages pace', () => {
    expect(distanceFromKm(1.609344, 'miles')).toBeCloseTo(1);
    expect(averagePace({ distanceKm: 25, durationMinutes: 126 })).toBeCloseTo(
      302.4
    );
    expect(averagePace({ distanceKm: 0, durationMinutes: 0 })).toBeNull();
  });

  it('maps load zones and baselines to tones', () => {
    expect(acwrTone('optimal')).toBe('good');
    expect(acwrTone('high')).toBe('warning');
    expect(acwrTone('very_high')).toBe('danger');
    expect(acwrTone(null)).toBe('muted');
    // HRV: lower than baseline is bad; resting HR: higher is bad.
    expect(baselineTone('below', true)).toBe('danger');
    expect(baselineTone('above', false)).toBe('danger');
    expect(baselineTone('above', true)).toBe('good');
    expect(baselineTone('insufficient_data', true)).toBe('muted');
  });
});
