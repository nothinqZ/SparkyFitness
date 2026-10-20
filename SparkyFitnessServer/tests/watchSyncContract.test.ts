import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { watchSessionUploadSchema } from '@workspace/shared';

// The fixture is the exact shape SparkyLogic.buildUpload produces on the watch
// (SparkyFitnessConnectIQ/source/SparkyLogic.mc). If the server schema changes
// in a way the watch app does not follow, this test fails first.
const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../SparkyFitnessConnectIQ/test/fixtures/upload.json',
        import.meta.url
      )
    ),
    'utf8'
  )
);

describe('Connect IQ upload contract', () => {
  it('accepts the payload the watch app sends', () => {
    const parsed = watchSessionUploadSchema.safeParse(fixture);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });

  it('accepts a session without the optional local start time', () => {
    const { started_at_local: _omit, ...withoutLocal } = fixture;
    expect(watchSessionUploadSchema.safeParse(withoutLocal).success).toBe(true);
  });
});
