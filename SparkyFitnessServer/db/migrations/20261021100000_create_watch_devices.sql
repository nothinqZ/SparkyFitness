-- Migration: Create watch_devices
-- Date: 2026-10-21
--
-- Which API key belongs to which paired Connect IQ watch. Pairing deletes its
-- handshake row once the watch has collected the key, so without this table
-- the server could no longer tell a watch key from any other API key. The row
-- lives exactly as long as its key: revoking the key (Settings > API Key
-- Management or unpairing in the apps) removes it through the foreign key.

CREATE TABLE IF NOT EXISTS public.watch_devices (
    api_key_id TEXT NOT NULL PRIMARY KEY REFERENCES public.api_key(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    device_id VARCHAR(128) NOT NULL,
    device_model VARCHAR(128),
    paired_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_watch_devices_user_device
    ON public.watch_devices(user_id, device_id);
