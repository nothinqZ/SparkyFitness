import { ConfigPlugin, withEntitlementsPlist } from 'expo/config-plugins';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sideloadStrippedEntitlements } = require('../app.sideload.js');

/**
 * Removes the entitlements a free Apple ID ("personal team") cannot sign, for
 * the SideStore sideload variant (see app.sideload.js).
 *
 * Like withoutPushNotificationEntitlement, this must be registered FIRST in
 * app.config.ts's plugin list so its mod runs LAST, after expo-notifications
 * has added `aps-environment` and app.config.ts the time-sensitive key.
 */
const withSideloadEntitlements: ConfigPlugin = (config) =>
  withEntitlementsPlist(config, (innerConfig) => {
    for (const key of sideloadStrippedEntitlements() as string[]) {
      delete innerConfig.modResults[key];
    }
    return innerConfig;
  });

export default withSideloadEntitlements;
