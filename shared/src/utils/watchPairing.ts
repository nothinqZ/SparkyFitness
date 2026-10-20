import { WATCH_PAIRING_CODE_ALPHABET } from "../schemas/api/WatchSync.api.zod.ts";

/**
 * Pairing-code input as typed by the user: keeps only code characters
 * (uppercased, so "abcd" works) and shows them grouped as "ABCD-EFGH", the
 * way the watch displays the code. Used by the web and mobile apps.
 */
export function formatWatchPairingCode(value: string): string {
  const clean = value
    .toUpperCase()
    .split("")
    .filter((ch) => WATCH_PAIRING_CODE_ALPHABET.includes(ch))
    .join("")
    .slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

export function isCompleteWatchPairingCode(value: string): boolean {
  return value.replace("-", "").length === 8;
}

// Part numbers (System.DeviceSettings.partNumber) that watch app versions
// before 0.1.2 reported instead of a product name. Newer versions send the
// name themselves (SparkyFitnessConnectIQ/resources-<device>).
const GARMIN_PART_NUMBER_NAMES: Record<string, string> = {
  "006-B4257-00": "Forerunner 265",
};

/** Product name for a reported device model, e.g. "Forerunner 265". */
export function garminProductName(model: string | null): string | null {
  if (model === null) return null;
  return GARMIN_PART_NUMBER_NAMES[model] ?? model;
}
