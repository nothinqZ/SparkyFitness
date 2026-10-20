import { z } from "zod";

export const watchSessionImportsIdSchema = z.string();

export const watchSessionImportsSchema = z.object({
  id: watchSessionImportsIdSchema,
  user_id: z.string(),
  client_session_id: z.string(),
  device_id: z.string(),
  device_model: z.string().nullable(),
  app_version: z.string().nullable(),
  payload_sha256: z.string(),
  exercise_preset_entry_id: z.string().nullable(),
  started_at: z.coerce.date(),
  ended_at: z.coerce.date(),
  started_at_local: z.string().nullable(),
  linked_garmin_activity_id: z.string().nullable(),
  linked_at: z.coerce.date().nullable(),
  created_at: z.coerce.date(),
});

export type WatchSessionImports = z.infer<typeof watchSessionImportsSchema>;
