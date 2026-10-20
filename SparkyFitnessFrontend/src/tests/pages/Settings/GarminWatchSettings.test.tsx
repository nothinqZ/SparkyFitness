import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Accordion } from '@/components/ui/accordion';
import { GarminWatchSettings } from '@/pages/Settings/GarminWatchSettings';
import { formatPairingCodeInput } from '@/utils/watchPairing';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, arg?: unknown) => (typeof arg === 'string' ? arg : key),
  }),
}));

const claim = jest.fn();
jest.mock('@/hooks/Settings/useWatchSync', () => ({
  useWatchSyncStatusQuery: () => ({
    isLoading: false,
    data: {
      last_upload_at: '2026-10-20T07:00:00.000Z',
      sessions_total: 3,
      sessions_linked_to_garmin: 2,
      devices: [
        {
          device_id: 'dev-1',
          device_model: 'fenix7',
          app_version: '0.1.0',
          last_seen_at: '2026-10-20T07:00:00.000Z',
        },
      ],
    },
  }),
  useClaimWatchPairingMutation: () => ({ mutate: claim, isPending: false }),
}));

const renderOpen = () =>
  render(
    <Accordion type="single" defaultValue="garmin-watch">
      <GarminWatchSettings />
    </Accordion>
  );

describe('formatPairingCodeInput', () => {
  it('uppercases, drops characters outside the code alphabet and groups 4-4', () => {
    expect(formatPairingCodeInput('abcd efgh')).toBe('ABCD-EFGH');
    // 0, O, 1 and I are not in the alphabet (ambiguous on a watch screen).
    expect(formatPairingCodeInput('a0b1cOdIe')).toBe('ABCD-E');
    expect(formatPairingCodeInput('ABCDEFGHJK')).toBe('ABCD-EFGH');
  });
});

describe('GarminWatchSettings', () => {
  beforeEach(() => claim.mockReset());

  it('shows the sync status and paired devices', () => {
    renderOpen();
    expect(screen.getByTestId('watch-sessions-total')).toHaveTextContent('3');
    expect(screen.getByText('fenix7')).toBeInTheDocument();
  });

  it('only submits a complete code', () => {
    renderOpen();
    const input = screen.getByLabelText('Pairing code shown on the watch');
    const button = screen.getByRole('button', { name: 'Pair' });
    fireEvent.change(input, { target: { value: 'abcd' } });
    expect(button).toBeDisabled();
    fireEvent.change(input, { target: { value: 'abcdefgh' } });
    expect(input).toHaveValue('ABCD-EFGH');
    fireEvent.click(button);
    expect(claim).toHaveBeenCalledWith('ABCD-EFGH', expect.any(Object));
  });
});
