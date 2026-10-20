-- Migration: Create watch_session_imports
-- Date: 2026-10-20
--
-- One row per workout session uploaded by the SparkyFitness Connect IQ watch
-- app. The row is the idempotency record for the upload (client_session_id is
-- generated on the watch) and the link used by the Garmin import to recognise
-- the same session when Garmin Connect later reports the recorded activity, so
-- the workout is not counted twice.

CREATE TABLE IF NOT EXISTS public.watch_session_imports (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    client_session_id UUID NOT NULL,
    device_id VARCHAR(128) NOT NULL,
    device_model VARCHAR(128),
    app_version VARCHAR(32),
    payload_sha256 CHAR(64) NOT NULL,
    exercise_preset_entry_id UUID REFERENCES public.exercise_preset_entries(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    started_at_local TIMESTAMP WITHOUT TIME ZONE,
    linked_garmin_activity_id VARCHAR(64),
    linked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT watch_session_imports_time_order CHECK (ended_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_session_imports_user_client
    ON public.watch_session_imports(user_id, client_session_id);

CREATE INDEX IF NOT EXISTS idx_watch_session_imports_user_started
    ON public.watch_session_imports(user_id, started_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_session_imports_user_garmin
    ON public.watch_session_imports(user_id, linked_garmin_activity_id)
    WHERE linked_garmin_activity_id IS NOT NULL;
