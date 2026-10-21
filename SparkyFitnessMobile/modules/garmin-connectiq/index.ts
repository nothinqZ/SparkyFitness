import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/** Connection state of a selected watch (IQDeviceStatus). */
export type GarminDeviceStatus =
  | 'invalidDevice'
  | 'bluetoothNotReady'
  | 'notFound'
  | 'notConnected'
  | 'connected'
  | 'unknown';

/** A watch picked in Garmin Connect's device selection. */
export interface GarminDevice {
  /** Device uuid assigned by Garmin Connect. */
  id: string;
  /** The name the user gave the watch in Garmin Connect. */
  name: string;
  model: string;
  status: GarminDeviceStatus;
}

export interface GarminMessageEvent {
  deviceId: string;
  /** Dictionary sent by the watch app with `Communications.transmit`. */
  message: unknown;
}

export interface GarminDeviceStatusEvent {
  deviceId: string;
  status: GarminDeviceStatus;
}

type GarminConnectIQEvents = {
  onMessage: (event: GarminMessageEvent) => void;
  onDeviceStatus: (event: GarminDeviceStatusEvent) => void;
};

declare class GarminConnectIQNativeModule extends NativeModule<GarminConnectIQEvents> {
  /** False when the app was built without Garmin's SDK. */
  isAvailable(): boolean;
  initialize(urlScheme: string): Promise<boolean>;
  showDeviceSelection(): Promise<boolean>;
  /** Parses Garmin Connect's device-selection reply and keeps the devices. */
  handleUrl(url: string): Promise<GarminDevice[]>;
  getDevices(): Promise<GarminDevice[]>;
  forgetDevices(): Promise<void>;
  /** Resolves with the number of connected watches that accepted it. */
  sendMessage(message: Record<string, unknown>): Promise<number>;
}

/**
 * Connect IQ Mobile SDK bridge (`ios/GarminConnectIQModule.swift`). Null on
 * Android and in builds without the native module.
 */
const GarminConnectIQ: GarminConnectIQNativeModule | null =
  Platform.OS === 'ios'
    ? requireOptionalNativeModule<GarminConnectIQNativeModule>(
        'GarminConnectIQ'
      )
    : null;

export default GarminConnectIQ;
