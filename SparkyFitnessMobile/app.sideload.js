// "sideload" build variant: an iOS build meant to be signed on the phone by
// SideStore/AltStore with a free Apple ID (personal team).
//
// Free Apple IDs may only have 3 App IDs active, and every app extension
// needs one of its own. The regular build ships an iOS widget, Live
// Activities (expo-widgets) and a watchOS app with complications, so this
// variant drops all of them and installs as a single App ID. The app's own
// Live Activity calls are best-effort and fail silently without the extension.
//
// Personal teams also cannot be granted Push Notifications or Time Sensitive
// Notifications; both entitlements are stripped (only local notifications are
// used, so behaviour is unchanged except that rest alerts follow Focus modes).
//
// Plain CommonJS so app.config.ts and the Jest tests can both load it.

const SIDELOAD_VARIANT = 'sideload';
const DEFAULT_SIDELOAD_BUNDLE_IDENTIFIER = 'com.sparkyfitness.personal';

// Bundle identifiers: reverse-DNS segments of letters, digits and hyphens.
const BUNDLE_ID_PATTERN =
  /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/;

const isSideloadVariant = (env = process.env) =>
  (env.APP_VARIANT || '') === SIDELOAD_VARIANT;

const sideloadBundleIdentifier = (env = process.env) => {
  const id =
    env.IOS_SIDELOAD_BUNDLE_IDENTIFIER || DEFAULT_SIDELOAD_BUNDLE_IDENTIFIER;
  if (!BUNDLE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid IOS_SIDELOAD_BUNDLE_IDENTIFIER: ${id}`);
  }
  return id;
};

const sideloadAppGroup = (env = process.env) =>
  `group.${sideloadBundleIdentifier(env)}`;

const pluginName = (entry) => (Array.isArray(entry) ? entry[0] : entry);

// Matches no directory under targets/, so @bacons/apple-targets adds none.
const NO_TARGETS_MATCH = '__sideload_has_no_extension_targets__';

/**
 * Rewrites the plugin list for the sideload variant: no Apple extension
 * targets, no expo-widgets extension. Everything else is kept in order.
 */
const sideloadPlugins = (plugins) =>
  plugins
    .filter((entry) => pluginName(entry) !== 'expo-widgets')
    .map((entry) =>
      pluginName(entry) === '@bacons/apple-targets'
        ? ['@bacons/apple-targets', { match: NO_TARGETS_MATCH }]
        : entry
    );

// Entitlements a personal team cannot be granted.
const SIDELOAD_STRIPPED_ENTITLEMENTS = [
  'aps-environment',
  'com.apple.developer.usernotifications.time-sensitive',
];

// HealthKit itself is available to personal teams. Whether SideStore can also
// provision HealthKit background delivery depends on Apple's current rules for
// free accounts; if installing fails with an entitlement error, rebuild with
// SIDELOAD_STRIP_HEALTHKIT_BACKGROUND=1 (HealthKit sync then runs only while
// the app is open).
const HEALTHKIT_BACKGROUND_ENTITLEMENT =
  'com.apple.developer.healthkit.background-delivery';

const sideloadStrippedEntitlements = (env = process.env) =>
  env.SIDELOAD_STRIP_HEALTHKIT_BACKGROUND === '1'
    ? [...SIDELOAD_STRIPPED_ENTITLEMENTS, HEALTHKIT_BACKGROUND_ENTITLEMENT]
    : [...SIDELOAD_STRIPPED_ENTITLEMENTS];

module.exports = {
  SIDELOAD_VARIANT,
  DEFAULT_SIDELOAD_BUNDLE_IDENTIFIER,
  SIDELOAD_STRIPPED_ENTITLEMENTS,
  HEALTHKIT_BACKGROUND_ENTITLEMENT,
  NO_TARGETS_MATCH,
  sideloadStrippedEntitlements,
  isSideloadVariant,
  sideloadBundleIdentifier,
  sideloadAppGroup,
  sideloadPlugins,
};
