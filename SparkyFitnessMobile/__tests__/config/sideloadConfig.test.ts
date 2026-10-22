import type { ExpoConfig } from 'expo/config';

const appJson = require('../../app.json');
const sideload = require('../../app.sideload.js');

type PluginEntry = string | [string, unknown];
const names = (plugins: PluginEntry[] = []) =>
  plugins.map((p) => (Array.isArray(p) ? p[0] : p));

function loadConfig(env: Record<string, string | undefined>): ExpoConfig {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
  }
  try {
    let config: ExpoConfig | undefined;
    jest.isolateModules(() => {
      const mod = require('../../app.config');
      const factory = mod.default ?? mod;
      config = factory({
        config: { ...appJson.expo, _internal: { projectRoot: '.' } },
        projectRoot: '.',
        staticConfigPath: null,
        packageJsonPath: null,
      });
    });
    return config as ExpoConfig;
  } finally {
    process.env = saved;
  }
}

jest.mock('tsx/cjs', () => ({}), { virtual: true });

describe('sideload variant (SideStore, free Apple ID)', () => {
  it('uses a stable custom bundle id and a matching app group', () => {
    const config = loadConfig({ APP_VARIANT: 'sideload' });
    expect(config.ios?.bundleIdentifier).toBe('com.sparkyfitness.personal');
    expect(config.ios?.appleTeamId).toBe('');
    expect(
      config.ios?.entitlements?.['com.apple.security.application-groups']
    ).toEqual(['group.com.sparkyfitness.personal']);
    expect(config.extra?.iosAppGroup).toBe('group.com.sparkyfitness.personal');
  });

  it('shows its own name next to the official app', () => {
    const config = loadConfig({ APP_VARIANT: 'sideload' });
    expect(config.ios?.infoPlist?.CFBundleDisplayName).toBe('Fitness IQ');
    expect(config.name).toBe('SparkyFitness');
    expect(
      loadConfig({ APP_VARIANT: 'production' }).ios?.infoPlist
        ?.CFBundleDisplayName
    ).toBeUndefined();
  });

  it('takes the build number from CI', () => {
    expect(
      loadConfig({ APP_VARIANT: 'sideload', IOS_BUILD_NUMBER: '42' }).ios
        ?.buildNumber
    ).toBe('42');
  });

  it('honours IOS_SIDELOAD_BUNDLE_IDENTIFIER and rejects malformed ids', () => {
    const config = loadConfig({
      APP_VARIANT: 'sideload',
      IOS_SIDELOAD_BUNDLE_IDENTIFIER: 'de.example.fitness',
    });
    expect(config.ios?.bundleIdentifier).toBe('de.example.fitness');
    expect(() =>
      sideload.sideloadBundleIdentifier({
        IOS_SIDELOAD_BUNDLE_IDENTIFIER: 'no spaces allowed',
      })
    ).toThrow();
  });

  it('ships no app extensions, so it needs a single App ID', () => {
    const plugins = loadConfig({ APP_VARIANT: 'sideload' })
      .plugins as PluginEntry[];
    expect(names(plugins)).not.toContain('expo-widgets');
    const targets = plugins.find(
      (p) => Array.isArray(p) && p[0] === '@bacons/apple-targets'
    );
    expect(targets).toEqual([
      '@bacons/apple-targets',
      { match: sideload.NO_TARGETS_MATCH },
    ]);
    // The entitlement stripper is registered first so its mod runs last.
    expect(names(plugins)[0]).toBe('./plugins/withSideloadEntitlements');
  });

  it('leaves the regular builds untouched', () => {
    const prod = loadConfig({ APP_VARIANT: 'production' });
    expect(prod.ios?.bundleIdentifier).toBe(
      'com.SparkyApps.SparkyFitnessMobile'
    );
    expect(names(prod.plugins as PluginEntry[])).toContain('expo-widgets');
    expect(names(prod.plugins as PluginEntry[])).toContain(
      '@bacons/apple-targets'
    );
    expect(names(prod.plugins as PluginEntry[])).not.toContain(
      './plugins/withSideloadEntitlements'
    );
    const dev = loadConfig({ APP_VARIANT: undefined });
    expect(dev.ios?.bundleIdentifier).toBe(
      'org.SparkyApps.SparkyFitnessMobile1.dev'
    );
  });

  it('strips the entitlements a personal team cannot sign', () => {
    expect(sideload.sideloadStrippedEntitlements({})).toEqual([
      'aps-environment',
      'com.apple.developer.usernotifications.time-sensitive',
    ]);
    expect(
      sideload.sideloadStrippedEntitlements({
        SIDELOAD_STRIP_HEALTHKIT_BACKGROUND: '1',
      })
    ).toContain('com.apple.developer.healthkit.background-delivery');
  });
});
