import { describe, expect, it } from 'vitest';
import {
  MATCH_WINDOW_MS,
  candidateSearchRange,
  findMatchingWatchSession,
} from '../services/watch/watchSessionMatcher.js';

const session = (
  id: string,
  startedAt: string,
  extra: Partial<{
    started_at_local: string | null;
    linked_garmin_activity_id: string | null;
  }> = {}
) => ({
  id,
  started_at: new Date(startedAt),
  started_at_local: extra.started_at_local ?? null,
  linked_garmin_activity_id: extra.linked_garmin_activity_id ?? null,
});

describe('findMatchingWatchSession', () => {
  it('matches a strength activity starting shortly after the watch session (GMT)', () => {
    const match = findMatchingWatchSession(
      {
        activityId: 111,
        startTimeGMT: '2026-10-20 06:02:30',
        activityType: { typeKey: 'strength_training' },
      },
      [session('a', '2026-10-20T06:00:00Z')]
    );
    expect(match?.id).toBe('a');
  });

  it('picks the closest of several candidates', () => {
    const match = findMatchingWatchSession(
      { activityId: 1, startTimeGMT: '2026-10-20 18:05:00' },
      [
        session('far', '2026-10-20T17:57:00Z'),
        session('near', '2026-10-20T18:04:00Z'),
      ]
    );
    expect(match?.id).toBe('near');
  });

  it('ignores sessions outside the match window', () => {
    const outside = new Date(
      Date.parse('2026-10-20T06:00:00Z') + MATCH_WINDOW_MS + 1000
    ).toISOString();
    expect(
      findMatchingWatchSession(
        { activityId: 1, startTimeGMT: outside.replace('T', ' ').slice(0, 19) },
        [session('a', '2026-10-20T06:00:00Z')]
      )
    ).toBeNull();
  });

  it('never matches runs or rides, even at the same time', () => {
    expect(
      findMatchingWatchSession(
        {
          activityId: 1,
          startTimeGMT: '2026-10-20 06:00:00',
          activityType: { typeKey: 'running' },
        },
        [session('a', '2026-10-20T06:00:00Z')]
      )
    ).toBeNull();
  });

  it('does not reuse a session already linked to another activity', () => {
    const candidates = [
      session('a', '2026-10-20T06:00:00Z', {
        linked_garmin_activity_id: '999',
      }),
    ];
    expect(
      findMatchingWatchSession(
        { activityId: 1, startTimeGMT: '2026-10-20 06:00:00' },
        candidates
      )
    ).toBeNull();
    // ...but the same activity re-synced still finds its session.
    expect(
      findMatchingWatchSession(
        { activityId: 999, startTimeGMT: '2026-10-20 06:00:00' },
        candidates
      )?.id
    ).toBe('a');
  });

  it('keeps an existing link on re-sync even when another session starts at the same time', () => {
    const candidates = [
      session('unlinked', '2026-10-20T06:00:00Z'),
      session('linked', '2026-10-20T06:00:00Z', {
        linked_garmin_activity_id: '777',
      }),
    ];
    expect(
      findMatchingWatchSession(
        { activityId: 777, startTimeGMT: '2026-10-20 06:01:00' },
        candidates
      )?.id
    ).toBe('linked');
  });

  it('falls back to local wall-clock times when Garmin sends no GMT start', () => {
    const match = findMatchingWatchSession(
      { activityId: 1, startTimeLocal: '2026-10-20T08:01:00.0' },
      [
        session('a', '2026-10-20T06:00:00Z', {
          started_at_local: '2026-10-20T08:00:00',
        }),
      ]
    );
    expect(match?.id).toBe('a');
  });
});

describe('candidateSearchRange', () => {
  it('returns null when the batch holds no matchable activity', () => {
    expect(
      candidateSearchRange([
        {
          startTimeGMT: '2026-10-20 06:00:00',
          activityType: { typeKey: 'running' },
        },
      ])
    ).toBeNull();
  });

  it('spans all matchable activities plus the match window', () => {
    const range = candidateSearchRange([
      {
        startTimeGMT: '2026-10-20 06:00:00',
        activityType: { typeKey: 'strength_training' },
      },
      { startTimeGMT: '2026-10-21 06:00:00' },
    ]);
    expect(range).toEqual({
      from: new Date(
        Date.parse('2026-10-20T06:00:00Z') - MATCH_WINDOW_MS
      ).toISOString(),
      to: new Date(
        Date.parse('2026-10-21T06:00:00Z') + MATCH_WINDOW_MS
      ).toISOString(),
    });
  });
});
