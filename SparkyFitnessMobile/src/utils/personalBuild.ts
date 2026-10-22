import Constants from 'expo-constants';

/**
 * The personal SideStore build ("Fitness Intelligence") runs next to the
 * official app and is training first: its home tab is the training home
 * instead of the daily dashboard. See app.sideload.js.
 */
export function isPersonalBuild(): boolean {
  return Constants.expoConfig?.extra?.APP_VARIANT === 'sideload';
}
