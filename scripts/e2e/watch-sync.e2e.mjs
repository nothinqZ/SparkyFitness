#!/usr/bin/env node
// End-to-end check of the watch sync API against a running server backed by a
// real PostgreSQL database (migrations + RLS applied). Creates two throwaway
// users, so never point it at a production server.
//
//   SPARKY_E2E_BASE_URL=http://localhost:3010 node scripts/e2e/watch-sync.e2e.mjs

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE = process.env.SPARKY_E2E_BASE_URL ?? "http://localhost:3010";
const ORIGIN = process.env.SPARKY_E2E_ORIGIN ?? "http://localhost:3004";

async function call(path, { method = "GET", body, cookie, apiKey, form } = {}) {
  const headers = { Origin: ORIGIN };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers.Cookie = cookie;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

async function signUp(label) {
  const email = `e2e-${label}-${Date.now()}@example.test`;
  const res = await call("/api/auth/sign-up/email", {
    method: "POST",
    body: { email, password: "E2e-password-123!", name: label },
  });
  assert.equal(res.status, 200, `sign-up failed: ${JSON.stringify(res.json)}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.ok(cookie, "no session cookie");
  return { email, cookie };
}

async function step(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const owner = await signUp("owner");
const other = await signUp("other");
let apiKey;
let readOnlyKey;
let exerciseId;
let presetId;
const sessionId = randomUUID();

await step(
  "create a full-access and a read-only API key for the watch",
  async () => {
    const res = await call("/api/auth/api-key/create", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "Garmin watch (e2e)" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    apiKey = res.json.key;
    assert.ok(apiKey?.length >= 32);
    const ro = await call("/api/auth/api-key/create", {
      method: "POST",
      cookie: owner.cookie,
      body: { name: "read-only (e2e)", permissions: { access: ["read"] } },
    });
    // Read-only scope is optional server config; only test it when supported.
    readOnlyKey = ro.status === 200 ? ro.json.key : null;
  },
);

await step("create an exercise and a workout preset", async () => {
  const form = new FormData();
  form.set(
    "exerciseData",
    JSON.stringify({
      name: "E2E Back Squat",
      category: "strength",
      calories_per_hour: 300,
      source: "custom",
    }),
  );
  const ex = await call("/api/exercises", {
    method: "POST",
    cookie: owner.cookie,
    form,
  });
  assert.equal(ex.status, 201, JSON.stringify(ex.json));
  exerciseId = ex.json.id;
  const preset = await call("/api/workout-presets", {
    method: "POST",
    cookie: owner.cookie,
    body: {
      name: "E2E Leg Day",
      exercises: [
        {
          exercise_id: exerciseId,
          sets: [
            {
              set_number: 1,
              set_type: "Working Set",
              reps: 5,
              weight: 100,
              rest_time: 120,
            },
            {
              set_number: 2,
              set_type: "Working Set",
              reps: 5,
              weight: 100,
              rest_time: 120,
            },
          ],
        },
      ],
    },
  });
  assert.equal(preset.status, 201, JSON.stringify(preset.json));
  presetId = preset.json.id;
});

await step(
  "a watch pairs itself with a code confirmed by the user",
  async () => {
    // The watch has no credentials and sends no Origin header.
    const raw = (path, body) =>
      fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(async (r) => ({ status: r.status, json: await r.json() }));
    const start = await raw("/api/v2/watch/pairing/start", {
      device_id: "e2e-pairing-device",
      device_model: "fenix7",
    });
    assert.equal(start.status, 201, JSON.stringify(start.json));
    const pending = await raw("/api/v2/watch/pairing/poll", {
      poll_token: start.json.poll_token,
    });
    assert.equal(pending.status, 202);
    const wrongCode = await call("/api/v2/watch/pairing/claim", {
      method: "POST",
      body: { pairing_code: "ZZZZ-ZZZZ" },
      cookie: other.cookie,
    });
    assert.equal(wrongCode.status, 404);
    const code = start.json.pairing_code;
    const claim = await call("/api/v2/watch/pairing/claim", {
      method: "POST",
      cookie: owner.cookie,
      body: {
        pairing_code: `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`,
      },
    });
    assert.equal(claim.status, 201, JSON.stringify(claim.json));
    const paired = await raw("/api/v2/watch/pairing/poll", {
      poll_token: start.json.poll_token,
    });
    assert.equal(paired.status, 200, JSON.stringify(paired.json));
    assert.ok(paired.json.api_key.length >= 32);
    // The key is handed out exactly once.
    const again = await raw("/api/v2/watch/pairing/poll", {
      poll_token: start.json.poll_token,
    });
    assert.equal(again.status, 404);
    const manifest = await call("/api/v2/watch/manifest", {
      apiKey: paired.json.api_key,
    });
    assert.equal(manifest.status, 200);
    // A claimed code cannot be claimed again by anyone.
    const reclaim = await call("/api/v2/watch/pairing/claim", {
      method: "POST",
      cookie: other.cookie,
      body: { pairing_code: code },
    });
    assert.equal(reclaim.status, 404);
  },
);

await step("watch downloads the manifest with its API key", async () => {
  const res = await call("/api/v2/watch/manifest?date=2026-10-20", { apiKey });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.equal(res.json.schema_version, 1);
  const workout = res.json.workouts.find(
    (w) => w.workout_preset_id === presetId,
  );
  assert.ok(workout, "preset missing from manifest");
  assert.equal(workout.exercises[0].exercise_id, exerciseId);
  assert.equal(workout.exercises[0].sets.length, 2);
  assert.equal(workout.exercises[0].sets[0].weight, 100);
  assert.equal(workout.exercises[0].previous, null);
});

await step("unauthenticated and garbage keys are refused", async () => {
  assert.equal((await call("/api/v2/watch/manifest")).status, 401);
  assert.equal(
    (await call("/api/v2/watch/manifest", { apiKey: "x".repeat(64) })).status,
    401,
  );
});

const upload = {
  client_session_id: sessionId,
  device_id: "e2e-device",
  device_model: "simulator",
  app_version: "0.1.0",
  workout_preset_id: null,
  name: "E2E Leg Day",
  entry_date: "2026-10-20",
  started_at: "2026-10-20T06:00:00.000Z",
  ended_at: "2026-10-20T06:45:00.000Z",
  started_at_local: "2026-10-20T08:00:00",
  exercises: [
    {
      exercise_id: undefined,
      sort_order: 0,
      sets: [
        {
          set_number: 1,
          reps: 5,
          weight: 102.5,
          rpe: 8,
          completed_at: "2026-10-20T06:05:00.000Z",
        },
        {
          set_number: 2,
          reps: 4,
          weight: 102.5,
          rir: 1,
          completed_at: "2026-10-20T06:09:00.000Z",
        },
      ],
    },
  ],
};

let entryId;
await step("first upload creates the workout (201)", async () => {
  upload.workout_preset_id = presetId;
  upload.exercises[0].exercise_id = exerciseId;
  const res = await call("/api/v2/watch/sessions", {
    method: "POST",
    apiKey,
    body: upload,
  });
  assert.equal(res.status, 201, JSON.stringify(res.json));
  assert.equal(res.json.status, "created");
  entryId = res.json.exercise_preset_entry_id;
});

await step(
  "retrying the same upload is a duplicate (200), not a second workout",
  async () => {
    const res = await call("/api/v2/watch/sessions", {
      method: "POST",
      apiKey,
      body: { ...upload, app_version: "0.1.1" },
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.status, "duplicate");
    assert.equal(res.json.exercise_preset_entry_id, entryId);
  },
);

await step("concurrent retries still produce exactly one workout", async () => {
  const concurrent = { ...upload, client_session_id: randomUUID() };
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      call("/api/v2/watch/sessions", {
        method: "POST",
        apiKey,
        body: concurrent,
      }),
    ),
  );
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(
    statuses,
    [200, 200, 200, 200, 201],
    JSON.stringify(results.map((r) => r.json)),
  );
  const ids = new Set(
    results.map((r) => r.json.exercise_preset_entry_id).filter(Boolean),
  );
  assert.ok(ids.size <= 1, `several workouts created: ${[...ids]}`);
});

await step(
  "reusing the session id for different content is a conflict (409)",
  async () => {
    const res = await call("/api/v2/watch/sessions", {
      method: "POST",
      apiKey,
      body: { ...upload, name: "Something else" },
    });
    assert.equal(res.status, 409, JSON.stringify(res.json));
  },
);

await step(
  "the uploaded workout is in the diary with sets, RPE and RIR",
  async () => {
    const res = await call(`/api/exercise-preset-entries/${entryId}`, {
      cookie: owner.cookie,
    });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.source, "sparky watch");
    const sets = res.json.exercises[0].sets;
    assert.equal(sets.length, 2);
    assert.equal(Number(sets[0].weight), 102.5);
    assert.equal(Number(sets[0].rpe), 8);
    assert.equal(Number(sets[1].rir), 1);
  },
);

await step(
  "the next manifest shows the logged sets as previous values",
  async () => {
    const res = await call("/api/v2/watch/manifest?date=2026-10-21", {
      apiKey,
    });
    const workout = res.json.workouts.find(
      (w) => w.workout_preset_id === presetId,
    );
    assert.equal(workout.exercises[0].previous.entry_date, "2026-10-20");
    assert.equal(workout.exercises[0].previous.sets[0].weight, 102.5);
  },
);

await step("sync status reports the device and uploads", async () => {
  const res = await call("/api/v2/watch/status", { apiKey });
  assert.equal(res.status, 200);
  assert.equal(res.json.sessions_total, 2);
  assert.equal(res.json.devices[0].device_id, "e2e-device");
});

await step("another user sees none of it (RLS)", async () => {
  const status = await call("/api/v2/watch/status", { cookie: other.cookie });
  assert.equal(status.json.sessions_total, 0);
  const entry = await call(`/api/exercise-preset-entries/${entryId}`, {
    cookie: other.cookie,
  });
  assert.ok([403, 404].includes(entry.status), `got ${entry.status}`);
  // Same client_session_id from another account is independent, not a conflict.
  const own = await call("/api/v2/watch/sessions", {
    method: "POST",
    cookie: other.cookie,
    body: {
      ...upload,
      exercises: [{ ...upload.exercises[0], exercise_id: exerciseId }],
    },
  });
  assert.notEqual(own.status, 409);
});

if (readOnlyKey) {
  await step(
    "a read-only key can read the manifest but cannot upload",
    async () => {
      assert.equal(
        (await call("/api/v2/watch/manifest", { apiKey: readOnlyKey })).status,
        200,
      );
      const res = await call("/api/v2/watch/sessions", {
        method: "POST",
        apiKey: readOnlyKey,
        body: { ...upload, client_session_id: randomUUID() },
      });
      assert.equal(res.status, 403);
    },
  );
}

await step("revoking the API key unpairs the watch", async () => {
  const list = await call("/api/auth/api-key/list", { cookie: owner.cookie });
  const keys = Array.isArray(list.json)
    ? list.json
    : (list.json?.apiKeys ?? []);
  const key = keys.find((k) => k.name === "Garmin watch (e2e)");
  assert.ok(key, JSON.stringify(list.json));
  const del = await call("/api/auth/api-key/delete", {
    method: "POST",
    cookie: owner.cookie,
    body: { keyId: key.id },
  });
  assert.equal(del.status, 200, JSON.stringify(del.json));
  // The middleware caches API-key sessions briefly; wait out the cache.
  const deadline = Date.now() + 90_000;
  let status;
  do {
    status = (await call("/api/v2/watch/manifest", { apiKey })).status;
    if (status === 401) break;
    await new Promise((r) => setTimeout(r, 5000));
  } while (Date.now() < deadline);
  assert.equal(status, 401);
});

console.log("watch sync e2e: all checks passed");
