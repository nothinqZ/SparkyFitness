-- Migration: Garmin activity <-> Sparky session link indexes
-- Date: 2026-10-22
--
-- The Garmin import attaches a Garmin strength activity to a native Sparky
-- session (services/garmin/garminSessionMerge.ts) through a
-- 'garmin_activity_link' activity detail. These partial unique indexes keep
-- that association 1:1 per user: one activity per session and one session per
-- activity. Imports also serialize per user with an advisory lock. Formerly
-- applied by hand from the homeserver's patches/garmin-merge-indexes.sql;
-- IF NOT EXISTS keeps it a no-op where that already happened.

CREATE UNIQUE INDEX IF NOT EXISTS sparky_garmin_link_activity_unique
ON exercise_entry_activity_details (created_by_user_id, (detail_data->>'activityId'))
WHERE provider_name = 'garmin' AND detail_type = 'garmin_activity_link';

CREATE UNIQUE INDEX IF NOT EXISTS sparky_garmin_link_session_unique
ON exercise_entry_activity_details (exercise_preset_entry_id)
WHERE provider_name = 'garmin' AND detail_type = 'garmin_activity_link';
