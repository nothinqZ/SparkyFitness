import type { TFunction } from 'i18next';
import type { FitnessFinding } from '@workspace/shared';

import i18n, { initializeI18n } from '../../src/localization/i18n';
import {
  confidenceLabel,
  evidenceLine,
  findingKindLabel,
  findingText,
  metricLabel,
} from '../../src/utils/insightText';

const finding = (over: Partial<FitnessFinding>): FitnessFinding => ({
  id: 'recovery.hrv_low',
  area: 'recovery',
  kind: 'observation',
  severity: 'notice',
  tone: 'caution',
  params: { hrv: 41.25, hrvBaseline: 55 },
  evidence: [],
  confidence: 'medium',
  ...over,
});

describe('insightText', () => {
  let t: TFunction;

  describe('en', () => {
    beforeAll(async () => {
      await initializeI18n('en');
      t = i18n.t.bind(i18n) as TFunction;
    });

    it('words a rule with localized numbers', () => {
      expect(findingText(t, finding({}))).toEqual({
        title: 'HRV below your normal range',
        detail: '7-day average 41.25 ms, usually 55 ms.',
      });
    });

    it('interpolates the exercise into strength titles', () => {
      const text = findingText(
        t,
        finding({
          id: 'strength.stall',
          params: { exercise: 'Bench Press', best: 100, weeks: 4 },
        })
      );
      expect(text.title).toBe('Bench Press may be stalling');
      expect(text.detail).toBe(
        'No better estimated 1RM than 100 kg for 4 weeks.'
      );
    });

    it('falls back to the id for a rule it does not know', () => {
      expect(findingText(t, finding({ id: 'future.rule' }))).toEqual({
        title: 'future.rule',
        detail: '',
      });
    });

    it('labels kind, confidence and evidence', () => {
      expect(findingKindLabel(t, 'hypothesis')).toBe('Possible');
      expect(findingKindLabel(t, 'finding')).toBe('Measured');
      expect(confidenceLabel(t, 'low')).toBe('low confidence');
      expect(
        evidenceLine(t, {
          metric: 'hrv',
          value: 41.5,
          unit: 'ms',
          period: '7d',
          source: 'device',
        })
      ).toBe('HRV 41.5 ms · 7d · Garmin');
      expect(metricLabel(t, 'unknownMetric')).toBe('unknownMetric');
    });
  });

  describe('de', () => {
    beforeAll(async () => {
      await initializeI18n('en');
      await i18n.changeLanguage('de');
      t = i18n.t.bind(i18n) as TFunction;
    });
    afterAll(async () => {
      await i18n.changeLanguage('en');
    });

    it('uses German words and decimal commas', () => {
      expect(findingText(t, finding({})).detail).toBe(
        '7-Tage-Schnitt 41,25 ms, üblich 55 ms.'
      );
      expect(findingKindLabel(t, 'observation')).toBe('Beobachtung');
    });
  });
});
