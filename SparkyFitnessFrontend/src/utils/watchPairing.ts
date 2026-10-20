import { WATCH_PAIRING_CODE_ALPHABET } from '@workspace/shared';

/** Keeps only pairing-code characters and shows them as "ABCD-EFGH". */
export function formatPairingCodeInput(value: string): string {
  const clean = value
    .toUpperCase()
    .split('')
    .filter((ch) => WATCH_PAIRING_CODE_ALPHABET.includes(ch))
    .join('')
    .slice(0, 8);
  return clean.length > 4 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}
