import { act, renderHook } from '@testing-library/react';
import { usePerformanceLayout } from '@/hooks/Performance/usePerformanceLayout';

describe('usePerformanceLayout', () => {
  beforeEach(() => window.localStorage.clear());

  it('persists hidden sections, sidebar state and range', () => {
    const { result } = renderHook(() => usePerformanceLayout());
    expect(result.current.layout).toEqual({
      hidden: [],
      sidebarCollapsed: false,
      days: 90,
    });
    act(() => result.current.toggleSection('nutrition'));
    act(() => result.current.update({ sidebarCollapsed: true, days: 365 }));

    const reloaded = renderHook(() => usePerformanceLayout());
    expect(reloaded.result.current.layout).toEqual({
      hidden: ['nutrition'],
      sidebarCollapsed: true,
      days: 365,
    });
    act(() => reloaded.result.current.toggleSection('nutrition'));
    expect(reloaded.result.current.layout.hidden).toEqual([]);
  });

  it('ignores corrupt or unknown stored values', () => {
    window.localStorage.setItem(
      'sparky.performance.layout.v1',
      JSON.stringify({ hidden: ['bogus', 'body'], days: 12 })
    );
    const { result } = renderHook(() => usePerformanceLayout());
    expect(result.current.layout).toEqual({
      hidden: ['body'],
      sidebarCollapsed: false,
      days: 90,
    });
    window.localStorage.setItem('sparky.performance.layout.v1', '{not json');
    expect(
      renderHook(() => usePerformanceLayout()).result.current.layout.days
    ).toBe(90);
  });
});
