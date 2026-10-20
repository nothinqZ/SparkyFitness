import { z } from "zod";

// Contract between the server and the SparkyFitness Garmin Connect IQ watch
// app (`SparkyFitnessConnectIQ/`). The watch downloads a compact manifest of
// planned workouts, logs sets offline, and uploads each finished session once
// with a client-generated idempotency key. Weights are always kilograms on the
// wire; the manifest tells the watch which unit to display.

const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

// "YYYY-MM-DDTHH:MM:SS" wall-clock time on the watch, without an offset.
// Garmin Connect reports `startTimeLocal` in the same shape, which is what the
// Garmin import matches against when it deduplicates watch sessions.
const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "Expected local datetime");

export const watchPlannedSetSchema = z.object({
  set_number: z.number().int().positive(),
  set_type: z.string().nullable(),
  reps: z.number().nullable(),
  weight: z.number().nullable(),
  duration: z.number().nullable(),
  rest_time: z.number().nullable(),
});

export const watchPreviousSetSchema = z.object({
  set_number: z.number().int().positive(),
  reps: z.number().nullable(),
  weight: z.number().nullable(),
});

export const watchPlannedExerciseSchema = z.object({
  exercise_id: z.string().uuid(),
  name: z.string(),
  category: z.string().nullable(),
  sort_order: z.number().int().min(0),
  sets: z.array(watchPlannedSetSchema),
  // Last logged performance of this exercise, so the watch can show
  // "last time" values and suggest progressive overload.
  previous: z
    .object({
      entry_date: dateStringSchema,
      sets: z.array(watchPreviousSetSchema),
    })
    .nullable(),
});

export const watchPlannedWorkoutSchema = z.object({
  workout_preset_id: z.number().int(),
  name: z.string(),
  // Set when this workout is scheduled on a specific day by an active plan.
  scheduled_date: dateStringSchema.nullable(),
  exercises: z.array(watchPlannedExerciseSchema),
});

export const watchManifestResponseSchema = z.object({
  schema_version: z.literal(1),
  generated_at: z.string(),
  weight_unit: z.enum(["kg", "lbs"]),
  default_rest_seconds: z.number().int().positive(),
  workouts: z.array(watchPlannedWorkoutSchema),
});

export const watchSessionSetSchema = z
  .object({
    set_number: z.number().int().positive(),
    set_type: z.string().max(50).nullable().optional(),
    reps: z.number().int().min(0).max(1000).nullable().optional(),
    // Kilograms.
    weight: z.number().min(0).max(2000).nullable().optional(),
    duration: z.number().int().min(0).max(86_400).nullable().optional(),
    rest_time: z.number().int().min(0).max(86_400).nullable().optional(),
    rpe: z.number().min(0).max(10).nullable().optional(),
    rir: z.number().min(0).max(10).nullable().optional(),
    completed_at: z.iso.datetime().nullable().optional(),
  })
  .strict();

export const watchSessionExerciseSchema = z
  .object({
    exercise_id: z.string().uuid(),
    sort_order: z.number().int().min(0).max(500),
    sets: z.array(watchSessionSetSchema).min(1).max(100),
  })
  .strict();

export const watchSessionUploadSchema = z
  .object({
    // Generated on the watch when the workout starts. Re-sending the same
    // session (retries after a timeout, a queue replay) is answered with the
    // original result instead of creating a second workout.
    client_session_id: z.string().uuid(),
    device_id: z.string().min(1).max(128),
    device_model: z.string().max(128).nullable().optional(),
    app_version: z.string().max(32).nullable().optional(),
    workout_preset_id: z.number().int().nullable().optional(),
    name: z.string().trim().min(1).max(255),
    entry_date: dateStringSchema,
    started_at: z.iso.datetime(),
    ended_at: z.iso.datetime(),
    started_at_local: localDateTimeSchema.nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    exercises: z.array(watchSessionExerciseSchema).min(1).max(50),
  })
  .strict()
  .refine((s) => Date.parse(s.ended_at) >= Date.parse(s.started_at), {
    message: "ended_at must not be before started_at",
    path: ["ended_at"],
  });

export const watchSessionUploadResponseSchema = z.object({
  status: z.enum(["created", "duplicate"]),
  client_session_id: z.string().uuid(),
  exercise_preset_entry_id: z.string().uuid().nullable(),
});

export const watchSyncStatusResponseSchema = z.object({
  last_upload_at: z.string().nullable(),
  sessions_total: z.number().int(),
  sessions_linked_to_garmin: z.number().int(),
  devices: z.array(
    z.object({
      device_id: z.string(),
      device_model: z.string().nullable(),
      app_version: z.string().nullable(),
      last_seen_at: z.string(),
    }),
  ),
});

export type WatchPlannedSet = z.infer<typeof watchPlannedSetSchema>;
export type WatchPlannedExercise = z.infer<typeof watchPlannedExerciseSchema>;
export type WatchPlannedWorkout = z.infer<typeof watchPlannedWorkoutSchema>;
export type WatchManifestResponse = z.infer<typeof watchManifestResponseSchema>;
export type WatchSessionUpload = z.infer<typeof watchSessionUploadSchema>;
export type WatchSessionUploadResponse = z.infer<
  typeof watchSessionUploadResponseSchema
>;
export type WatchSyncStatusResponse = z.infer<
  typeof watchSyncStatusResponseSchema
>;

// --- Pairing -----------------------------------------------------------------
// A side-loaded watch app cannot have its settings edited in Garmin Connect,
// so the watch pairs itself: it asks for a short code, shows it, and polls
// while the user confirms the code in SparkyFitness. Confirming mints a
// regular, revocable API key, which the watch collects exactly once.

export const WATCH_PAIRING_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const watchPairingStartRequestSchema = z
  .object({
    device_id: z.string().min(1).max(128),
    device_model: z.string().max(128).nullable().optional(),
  })
  .strict();

export const watchPairingStartResponseSchema = z.object({
  pairing_code: z.string(),
  poll_token: z.string(),
  expires_at: z.string(),
  poll_interval_seconds: z.number().int().positive(),
});

export const watchPairingPollRequestSchema = z
  .object({ poll_token: z.string().min(32).max(128) })
  .strict();

export const watchPairingPollResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending") }),
  z.object({ status: z.literal("paired"), api_key: z.string() }),
]);

export const watchPairingClaimRequestSchema = z
  .object({
    // Accepts "ABCD-EFGH", "abcd efgh" or "ABCDEFGH".
    pairing_code: z
      .string()
      .transform((v) => v.toUpperCase().replace(/[^A-Z0-9]/g, ""))
      .pipe(z.string().length(8)),
  })
  .strict();

export const watchPairingClaimResponseSchema = z.object({
  paired: z.literal(true),
  api_key_id: z.string(),
  api_key_name: z.string(),
});

export type WatchPairingStartRequest = z.infer<
  typeof watchPairingStartRequestSchema
>;
export type WatchPairingStartResponse = z.infer<
  typeof watchPairingStartResponseSchema
>;
export type WatchPairingPollResponse = z.infer<
  typeof watchPairingPollResponseSchema
>;
export type WatchPairingClaimResponse = z.infer<
  typeof watchPairingClaimResponseSchema
>;

// --- Paired watches ------------------------------------------------------------
// Every paired watch is one API key. Listing them lets the web and mobile apps
// show and unpair watches without sending users to API Key Management.

export const watchPairedDeviceSchema = z.object({
  api_key_id: z.string(),
  name: z.string(),
  // Null for keys paired before the pairing stored the device on the key.
  device_id: z.string().nullable(),
  device_model: z.string().nullable(),
  paired_at: z.string(),
  // Last request the watch made with its key (manifest download or upload).
  last_used_at: z.string().nullable(),
  // Last workout this watch uploaded, and the app version it reported then.
  last_upload_at: z.string().nullable(),
  app_version: z.string().nullable(),
});

export const watchPairedDevicesResponseSchema = z.object({
  devices: z.array(watchPairedDeviceSchema),
});

export type WatchPairedDevice = z.infer<typeof watchPairedDeviceSchema>;
export type WatchPairedDevicesResponse = z.infer<
  typeof watchPairedDevicesResponseSchema
>;
