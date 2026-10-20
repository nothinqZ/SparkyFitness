import { describe, expect, it } from 'vitest';
import { extractGarminTelemetryFields } from '../services/garmin/garminTelemetryExtractors.js';

// Garmin reports a per-activity training load (EPOC) and aerobic/anaerobic
// training effects. They feed the performance dashboard's estimated
// acute:chronic load, so the import must keep them.
describe('extractGarminTelemetryFields: training load and effects', () => {
  it('maps Garmin activity load and training effects, rounded to the column scale', () => {
    const fields = extractGarminTelemetryFields({
      activity: {
        activityTrainingLoad: 142.83127,
        aerobicTrainingEffect: 3.4499998,
        anaerobicTrainingEffect: 1.0399999,
      },
    });
    expect(fields.training_load).toBe(142.83);
    expect(fields.aerobic_training_effect).toBe(3.4);
    expect(fields.anaerobic_training_effect).toBe(1);
  });

  it('leaves them null when Garmin does not report them', () => {
    const fields = extractGarminTelemetryFields({ activity: {} });
    expect(fields.training_load).toBeNull();
    expect(fields.aerobic_training_effect).toBeNull();
    expect(fields.anaerobic_training_effect).toBeNull();
  });
});
