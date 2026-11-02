import { useCallback } from 'react';

import { useCycleMode } from './useCycleMode';
import type { AddMenuItemKey } from '../constants/addMenuItems';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';

/**
 * Whether the + sheet can show an item right now. Check-In needs the guided
 * check-in setting and the cycle row needs cycle tracking; every other item is
 * always offered. Settings and its preview use this to match the sheet.
 */
export function useAddMenuItemAvailable(): (key: AddMenuItemKey) => boolean {
  const guidedCheckInEnabled = useAppPreferencesStore(
    (s) => s.guidedCheckInEnabled
  );
  const { enabled: cycleEnabled } = useCycleMode();
  return useCallback(
    (key) => {
      if (key === 'checkIn') return guidedCheckInEnabled;
      if (key === 'wellness') return cycleEnabled;
      return true;
    },
    [cycleEnabled, guidedCheckInEnabled]
  );
}
