import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';
import {
  formatWatchPairingCode,
  isCompleteWatchPairingCode,
  type WatchPairedDevice,
  type WatchSyncStatusResponse,
} from '@workspace/shared';

import GarminConnectIQ from '../../modules/garmin-connectiq';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import Icon from '../components/Icon';
import Button from '../components/ui/Button';
import { usePreferences } from '../hooks';
import {
  useClaimWatchPairing,
  usePairedWatches,
  useUnpairWatch,
} from '../hooks/useGarminWatch';
import { useWatchSyncStatus } from '../hooks/usePerformance';
import { useRefetchOnFocus } from '../hooks/useRefetchOnFocus';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { ApiError } from '../services/api/errors';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useGarminWatchStore } from '../stores/garminWatchStore';
import type { RootStackScreenProps } from '../types/navigation';
import { formatRelativeTime } from '../utils/dateUtils';

type GarminWatchSettingsScreenProps =
  RootStackScreenProps<'GarminWatchSettings'>;

// A watch that made a request within this window counts as in sync, the way
// Garmin Connect shows a recently synced device as connected.
const RECENT_SYNC_MS = 24 * 60 * 60 * 1000;

/**
 * Pairs the Sparky Strength Connect IQ app on a Garmin watch with this
 * account and manages paired watches, laid out like the device page in
 * Garmin Connect: one card per watch with its product name, sync state and
 * "Remove", and an "Add watch" flow. The watch shows a code under
 * "Pair watch"; confirming it here mints an API key that the watch collects
 * by itself. Removing revokes that key. Unlike the Apple Watch, the Garmin
 * watch talks to the server through the Garmin Connect app, not this app, so
 * the phone only confirms and lists.
 */
const GarminWatchSettingsScreen: React.FC<
  GarminWatchSettingsScreenProps
> = () => {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();
  const [textMuted, accentPrimary, success] = useCSSVariable([
    '--color-text-muted',
    '--color-accent-primary',
    '--color-icon-success',
  ]) as [string, string, string];
  const { preferences } = usePreferences();

  const [code, setCode] = useState('');
  const { devices, isError, refetch } = usePairedWatches();
  const { data: status } = useWatchSyncStatus();
  const claim = useClaimWatchPairing();
  const unpair = useUnpairWatch();
  // "Now" for the sync dot, taken when the screen is shown rather than on
  // every render (render must stay pure).
  const [now, setNow] = useState(() => Date.now());
  useRefetchOnFocus(
    useCallback(() => {
      setNow(Date.now());
      void refetch();
    }, [refetch])
  );

  const header = useScreenHeader({
    title: t('screens.garminWatchSettings', { defaultValue: 'Garmin watch' }),
    left: { kind: 'back' },
  });

  const deviceFallbackName = t('screens.garminWatchSettings', {
    defaultValue: 'Garmin watch',
  });
  const hasDevices = (devices?.length ?? 0) > 0;

  const relative = (iso: string | null) =>
    formatRelativeTime(
      iso ? new Date(iso) : null,
      t,
      i18n.language,
      preferences?.time_format
    );

  const pairErrorMessage = (error: unknown) => {
    const statusCode = error instanceof ApiError ? error.statusCode : null;
    if (statusCode === 404 || statusCode === 400) {
      return t('garminWatch.pairErrorCode', {
        defaultValue:
          'This code is unknown or expired. Codes are valid for 10 minutes; start pairing on the watch again for a new one.',
      });
    }
    if (statusCode === 403) {
      return t('garminWatch.pairErrorReadOnly', {
        defaultValue:
          'This app is signed in with a read-only API key, which cannot pair a watch.',
      });
    }
    if (statusCode === 429) {
      return t('garminWatch.pairErrorRateLimited', {
        defaultValue: 'Too many attempts. Wait a few minutes and try again.',
      });
    }
    return t('common.tryAgain', { defaultValue: 'Please try again.' });
  };

  const submit = () => {
    if (!isCompleteWatchPairingCode(code) || claim.isPending) return;
    claim.mutate(code, {
      onSuccess: () => {
        setCode('');
        Toast.show({
          type: 'success',
          text1: t('garminWatch.paired', { defaultValue: 'Watch paired' }),
          text2: t('garminWatch.pairedDetail', {
            defaultValue: 'It finishes setup on its own within a few seconds.',
          }),
        });
      },
      onError: (error) => {
        Toast.show({
          type: 'error',
          text1: t('garminWatch.pairError', {
            defaultValue: 'Pairing failed',
          }),
          text2: pairErrorMessage(error),
        });
      },
    });
  };

  const confirmUnpair = (device: WatchPairedDevice) => {
    Alert.alert(
      t('garminWatch.unpairTitle', {
        defaultValue: 'Remove {{name}}?',
        name: device.device_model ?? deviceFallbackName,
      }),
      t('garminWatch.unpairMessage', {
        defaultValue:
          'The watch can no longer download workouts or upload sessions until it is paired again. Workouts it has not uploaded yet stay on the watch.',
      }),
      [
        {
          text: t('common.cancel', { defaultValue: 'Cancel' }),
          style: 'cancel',
        },
        {
          text: t('garminWatch.unpair', { defaultValue: 'Remove' }),
          style: 'destructive',
          onPress: () =>
            unpair.mutate(device.api_key_id, {
              onError: () =>
                Toast.show({
                  type: 'error',
                  text1: t('garminWatch.unpairError', {
                    defaultValue: 'The watch could not be removed',
                  }),
                  text2: t('common.tryAgain', {
                    defaultValue: 'Please try again.',
                  }),
                }),
            }),
        },
      ]
    );
  };

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: 16,
          paddingTop: 16,
          paddingBottom: insets.bottom + 80 + activeWorkoutBarPadding,
        }}
        contentInsetAdjustmentBehavior={
          usesNativeHeader ? 'automatic' : 'never'
        }
      >
        <BluetoothCard successColor={success} mutedColor={textMuted} />

        {isError && (
          <Text className="text-text-secondary text-sm mb-4">
            {t('garminWatch.devicesError', {
              defaultValue: 'Paired watches could not be loaded.',
            })}
          </Text>
        )}

        {(devices ?? []).map((device) => (
          <DeviceCard
            key={device.api_key_id}
            device={device}
            name={device.device_model ?? deviceFallbackName}
            // Upload counts are per account; they describe the watch only
            // while it is the only one.
            status={devices!.length === 1 ? status : undefined}
            lastSync={relative(device.last_used_at)}
            now={now}
            accentColor={accentPrimary}
            successColor={success}
            mutedColor={textMuted}
            onRemove={() => confirmUnpair(device)}
            removeDisabled={unpair.isPending}
          />
        ))}

        <View className="bg-surface rounded-2xl p-4 mb-4">
          <Text className="text-text-primary text-lg font-bold mb-1">
            {hasDevices
              ? t('garminWatch.addAnotherTitle', {
                  defaultValue: 'Add another watch',
                })
              : t('garminWatch.addTitle', { defaultValue: 'Add a watch' })}
          </Text>
          {!hasDevices && !isError && (
            <Text className="text-text-secondary text-sm mb-3">
              {t('garminWatch.noDevices', {
                defaultValue:
                  'No watch is paired yet. Sparky Strength logs your sets on the watch and uploads them to SparkyFitness.',
              })}
            </Text>
          )}
          <PairStep
            number={1}
            text={t('garminWatch.step1', {
              defaultValue: 'On the watch, open Sparky Strength.',
            })}
          />
          <PairStep
            number={2}
            text={t('garminWatch.step2', {
              defaultValue: 'Choose "Pair watch". The watch shows a code.',
            })}
          />
          <PairStep
            number={3}
            text={t('garminWatch.step3', {
              defaultValue:
                'Enter the code here. Keep the Garmin Connect app running so the watch can finish setup.',
            })}
          />
          <TextInput
            testID="garmin-pairing-code"
            accessibilityLabel={t('garminWatch.codeLabel', {
              defaultValue: 'Pairing code shown on the watch',
            })}
            value={code}
            onChangeText={(value) => setCode(formatWatchPairingCode(value))}
            onSubmitEditing={submit}
            placeholder={t('garminWatch.codePlaceholder', {
              defaultValue: 'ABCD-EFGH',
            })}
            placeholderTextColor={textMuted || '#94a3b8'}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            spellCheck={false}
            returnKeyType="done"
            maxLength={9}
            className="bg-background border border-border rounded-xl px-4 py-3 mt-2 text-2xl text-center tracking-widest text-text-primary"
            style={{ fontVariant: ['tabular-nums'] }}
          />
          <Button
            testID="garmin-pair-button"
            variant="primary"
            className="mt-3 py-3"
            disabled={!isCompleteWatchPairingCode(code)}
            loading={claim.isPending}
            onPress={submit}
          >
            {t('garminWatch.pair', { defaultValue: 'Pair' })}
          </Button>
        </View>
      </ScrollView>
    </View>
  );
};

interface DeviceCardProps {
  device: WatchPairedDevice;
  name: string;
  status: WatchSyncStatusResponse | undefined;
  lastSync: string;
  now: number;
  accentColor: string;
  successColor: string;
  mutedColor: string;
  onRemove: () => void;
  removeDisabled: boolean;
}

function DeviceCard({
  device,
  name,
  status,
  lastSync,
  now,
  accentColor,
  successColor,
  mutedColor,
  onRemove,
  removeDisabled,
}: DeviceCardProps) {
  const { t } = useTranslation();
  const recent =
    device.last_used_at !== null &&
    now - new Date(device.last_used_at).getTime() < RECENT_SYNC_MS;

  return (
    <View
      testID={`garmin-watch-${device.api_key_id}`}
      className="bg-surface rounded-2xl mb-4 overflow-hidden"
    >
      <View className="items-center px-4 pt-6 pb-4">
        <View
          className="w-20 h-20 rounded-full items-center justify-center mb-3"
          style={{ backgroundColor: `${accentColor}22` }}
        >
          <Icon name="garmin-watch" size={40} color={accentColor} />
        </View>
        <Text className="text-text-primary text-xl font-bold text-center">
          {name}
        </Text>
        <Text className="text-text-secondary text-sm mt-0.5">
          {device.app_version
            ? t('garminWatch.appVersion', {
                defaultValue: 'Sparky Strength {{version}}',
                version: device.app_version,
              })
            : t('garminWatch.appName', { defaultValue: 'Sparky Strength' })}
        </Text>
        <View className="flex-row items-center mt-3">
          <View
            className="w-2 h-2 rounded-full mr-2"
            style={{ backgroundColor: recent ? successColor : mutedColor }}
          />
          <Text
            testID={`garmin-sync-${device.api_key_id}`}
            className="text-text-secondary text-sm"
          >
            {device.last_used_at
              ? t('garminWatch.lastSynced', {
                  defaultValue: 'Last synced: {{time}}',
                  time: lastSync,
                })
              : t('garminWatch.notSyncedYet', {
                  defaultValue: 'Not synced yet',
                })}
          </Text>
        </View>
      </View>

      {status && (
        <View className="flex-row border-t border-border">
          <Stat
            testID="garmin-sessions-total"
            value={String(status.sessions_total)}
            label={t('garminWatch.sessions', {
              defaultValue: 'Workouts uploaded',
            })}
          />
          <View className="w-px bg-border" />
          <Stat
            value={String(status.sessions_linked_to_garmin)}
            label={t('garminWatch.linked', {
              defaultValue: 'Linked to Garmin activities',
            })}
          />
        </View>
      )}

      <Pressable
        testID={`garmin-unpair-${device.api_key_id}`}
        accessibilityRole="button"
        disabled={removeDisabled}
        onPress={onRemove}
        className="border-t border-border py-3.5 items-center active:opacity-70"
      >
        <Text className="text-icon-danger font-medium">
          {t('garminWatch.unpair', { defaultValue: 'Remove' })}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * The live Bluetooth link (Connect IQ Mobile SDK) that keeps a running
 * workout in step between phone and watch without internet. Picking the
 * watch happens once, in Garmin Connect.
 */
function BluetoothCard({
  successColor,
  mutedColor,
}: {
  successColor: string;
  mutedColor: string;
}) {
  const { t } = useTranslation();
  const ready = useGarminWatchStore((s) => s.ready);
  const devices = useGarminWatchStore((s) => s.devices);
  const setDevices = useGarminWatchStore((s) => s.setDevices);
  if (!ready || GarminConnectIQ == null) return null;
  const sdk = GarminConnectIQ;

  const select = () => {
    void sdk.showDeviceSelection();
  };
  const forget = () => {
    Alert.alert(
      t('garminWatch.bluetoothForgetTitle', {
        defaultValue: 'Disconnect the watch?',
      }),
      t('garminWatch.bluetoothForgetMessage', {
        defaultValue:
          'Workouts no longer sync live with the watch. Pairing for uploads stays as it is.',
      }),
      [
        {
          text: t('common.cancel', { defaultValue: 'Cancel' }),
          style: 'cancel',
        },
        {
          text: t('garminWatch.bluetoothForget', {
            defaultValue: 'Disconnect',
          }),
          style: 'destructive',
          onPress: () => {
            void sdk.forgetDevices().then(() => setDevices([]));
          },
        },
      ]
    );
  };

  return (
    <View testID="garmin-bluetooth" className="bg-surface rounded-2xl p-4 mb-4">
      <Text className="text-text-primary text-lg font-bold mb-1">
        {t('garminWatch.bluetoothTitle', { defaultValue: 'Live sync' })}
      </Text>
      <Text className="text-text-secondary text-sm mb-3">
        {t('garminWatch.bluetoothDescription', {
          defaultValue:
            'Keeps a running workout in step between phone and watch over Bluetooth, also without internet: start it on either, log sets on either.',
        })}
      </Text>
      {devices.map((device) => {
        const connected = device.status === 'connected';
        return (
          <View key={device.id} className="flex-row items-center mb-3">
            <View
              className="w-2 h-2 rounded-full mr-2"
              style={{ backgroundColor: connected ? successColor : mutedColor }}
            />
            <Text className="flex-1 text-text-primary">
              {device.name || device.model}
            </Text>
            <Text className="text-text-secondary text-sm">
              {connected
                ? t('garminWatch.bluetoothConnected', {
                    defaultValue: 'Connected',
                  })
                : t('garminWatch.bluetoothNotConnected', {
                    defaultValue: 'Not connected',
                  })}
            </Text>
          </View>
        );
      })}
      <Button
        testID="garmin-bluetooth-select"
        variant={devices.length === 0 ? 'primary' : 'secondary'}
        className="py-3"
        onPress={select}
      >
        {devices.length === 0
          ? t('garminWatch.bluetoothConnect', {
              defaultValue: 'Connect with Garmin Connect',
            })
          : t('garminWatch.bluetoothChange', {
              defaultValue: 'Choose another watch',
            })}
      </Button>
      {devices.length > 0 && (
        <Pressable
          testID="garmin-bluetooth-forget"
          accessibilityRole="button"
          onPress={forget}
          className="py-3 items-center active:opacity-70"
        >
          <Text className="text-icon-danger font-medium">
            {t('garminWatch.bluetoothForget', { defaultValue: 'Disconnect' })}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function Stat({
  value,
  label,
  testID,
}: {
  value: string;
  label: string;
  testID?: string;
}) {
  return (
    <View className="flex-1 items-center py-3 px-2">
      <Text testID={testID} className="text-text-primary text-xl font-bold">
        {value}
      </Text>
      <Text className="text-text-secondary text-xs text-center mt-0.5">
        {label}
      </Text>
    </View>
  );
}

function PairStep({ number, text }: { number: number; text: string }) {
  return (
    <View className="flex-row items-start mb-2">
      <View className="w-6 h-6 rounded-full bg-accent-primary items-center justify-center mr-3 mt-0.5">
        <Text className="text-white text-xs font-bold">{number}</Text>
      </View>
      <Text className="flex-1 text-text-primary text-sm">{text}</Text>
    </View>
  );
}

export default GarminWatchSettingsScreen;
