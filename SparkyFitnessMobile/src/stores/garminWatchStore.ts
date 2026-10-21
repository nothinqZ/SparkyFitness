import { create } from 'zustand';
import type { GarminDevice } from '../../modules/garmin-connectiq';

/**
 * Bluetooth link to the Garmin watch, as reported by the Connect IQ SDK
 * (`useGarminWatchBridge`). Transient: the SDK keeps the selected devices
 * itself, so nothing here is persisted.
 */
interface GarminWatchState {
  /** The SDK started; false in builds without it. */
  ready: boolean;
  devices: GarminDevice[];
  setReady: (ready: boolean) => void;
  setDevices: (devices: GarminDevice[]) => void;
  setDeviceStatus: (deviceId: string, status: GarminDevice['status']) => void;
}

export const useGarminWatchStore = create<GarminWatchState>((set) => ({
  ready: false,
  devices: [],
  setReady: (ready) => set({ ready }),
  setDevices: (devices) => set({ devices }),
  setDeviceStatus: (deviceId, status) =>
    set((state) => ({
      devices: state.devices.map((device) =>
        device.id === deviceId ? { ...device, status } : device
      ),
    })),
}));
