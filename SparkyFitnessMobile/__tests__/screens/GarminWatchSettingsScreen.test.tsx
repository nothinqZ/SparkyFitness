import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import Toast from 'react-native-toast-message';

import GarminWatchSettingsScreen from '../../src/screens/GarminWatchSettingsScreen';
import {
  useClaimWatchPairing,
  usePairedWatches,
  useUnpairWatch,
} from '../../src/hooks/useGarminWatch';
import { useWatchSyncStatus } from '../../src/hooks/usePerformance';
import { initializeI18n } from '../../src/localization/i18n';
import { ApiError } from '../../src/services/api/errors';
import type { RootStackScreenProps } from '../../src/types/navigation';

jest.mock('../../src/hooks/useGarminWatch', () => ({
  usePairedWatches: jest.fn(),
  useClaimWatchPairing: jest.fn(),
  useUnpairWatch: jest.fn(),
}));
jest.mock('../../src/hooks', () => ({
  usePreferences: () => ({ preferences: null }),
}));
jest.mock('../../src/hooks/usePerformance', () => ({
  useWatchSyncStatus: jest.fn(),
}));
jest.mock('../../src/hooks/useRefetchOnFocus', () => ({
  useRefetchOnFocus: jest.fn(),
}));
jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: () => null,
}));
jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSHeadersActive: () => false,
}));
jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: () => 0,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const props = {} as unknown as RootStackScreenProps<'GarminWatchSettings'>;
const claim = jest.fn();
const unpair = jest.fn();

describe('GarminWatchSettingsScreen', () => {
  beforeAll(async () => {
    await initializeI18n('en');
  });

  beforeEach(() => {
    claim.mockReset();
    unpair.mockReset();
    jest.mocked(usePairedWatches).mockReturnValue({
      devices: [
        {
          api_key_id: 'key-1',
          name: 'Garmin watch 006-B4257-00',
          device_id: 'dev-1',
          device_model: 'Forerunner 265',
          paired_at: '2026-10-20T21:42:59.000Z',
          last_used_at: new Date(Date.now() - 5 * 60_000).toISOString(),
          last_upload_at: null,
          app_version: '0.1.1',
        },
      ],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as never);
    jest.mocked(useClaimWatchPairing).mockReturnValue({
      mutate: claim,
      isPending: false,
    } as never);
    jest.mocked(useUnpairWatch).mockReturnValue({
      mutate: unpair,
      isPending: false,
    } as never);
    jest.mocked(useWatchSyncStatus).mockReturnValue({
      data: {
        last_upload_at: null,
        sessions_total: 4,
        sessions_linked_to_garmin: 3,
        devices: [],
      },
      isError: false,
    });
  });

  it('formats the code as typed and only pairs a complete one', () => {
    const screen = render(<GarminWatchSettingsScreen {...props} />);
    const input = screen.getByTestId('garmin-pairing-code');

    fireEvent.changeText(input, 'k7qm');
    fireEvent.press(screen.getByTestId('garmin-pair-button'));
    expect(claim).not.toHaveBeenCalled();

    // Lowercase and look-alike characters (0, O, 1, I) are cleaned up.
    fireEvent.changeText(input, 'k7qm 2xpa0');
    expect(input.props.value).toBe('K7QM-2XPA');
    fireEvent.press(screen.getByTestId('garmin-pair-button'));
    expect(claim).toHaveBeenCalledWith('K7QM-2XPA', expect.any(Object));
  });

  it('explains an expired code', () => {
    const show = jest.spyOn(Toast, 'show').mockImplementation(() => {});
    claim.mockImplementation((_code, options) =>
      options.onError(new ApiError('Server error: 404', 404))
    );
    const screen = render(<GarminWatchSettingsScreen {...props} />);
    fireEvent.changeText(screen.getByTestId('garmin-pairing-code'), 'K7QM2XPA');
    fireEvent.press(screen.getByTestId('garmin-pair-button'));
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        text2: expect.stringContaining('unknown or expired'),
      })
    );
    show.mockRestore();
  });

  it('lists paired watches and unpairs only after confirming', () => {
    const alert = jest.spyOn(Alert, 'alert');
    const screen = render(<GarminWatchSettingsScreen {...props} />);
    expect(screen.getByText('Forerunner 265')).toBeTruthy();
    expect(screen.getByText('Sparky Strength 0.1.1')).toBeTruthy();
    expect(screen.getByTestId('garmin-sync-key-1').props.children).toBe(
      'Last synced: 5 minutes ago'
    );
    expect(screen.getByTestId('garmin-sessions-total').props.children).toBe(
      '4'
    );
    expect(screen.getByText('Add another watch')).toBeTruthy();

    fireEvent.press(screen.getByTestId('garmin-unpair-key-1'));
    expect(unpair).not.toHaveBeenCalled();
    expect(alert.mock.calls[0]![0]).toBe('Remove Forerunner 265?');
    const buttons = alert.mock.calls[0]![2]!;
    buttons.find((b) => b.style === 'destructive')!.onPress!();
    expect(unpair).toHaveBeenCalledWith('key-1', expect.any(Object));
    alert.mockRestore();
  });

  it('says when no watch is paired', () => {
    jest.mocked(usePairedWatches).mockReturnValue({
      devices: [],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as never);
    const screen = render(<GarminWatchSettingsScreen {...props} />);
    expect(screen.getByText('Add a watch')).toBeTruthy();
    expect(screen.getByText(/No watch is paired yet/)).toBeTruthy();
    expect(screen.queryByTestId('garmin-sessions-total')).toBeNull();
  });
});
