-- Migration: Create watch_pairing_requests
-- Date: 2026-10-20
--
-- Short-lived pairing handshakes for the Connect IQ watch app. The watch
-- starts a request (unauthenticated) and polls with a secret token, whose
-- SHA-256 is all that is stored. A signed-in user confirms the displayed
-- pairing code, which mints an API key; the key is stored AES-GCM encrypted
-- until the watch collects it once, then the row is deleted. Rows expire after
-- 10 minutes. Only the server's system connection touches this table.

CREATE TABLE IF NOT EXISTS public.watch_pairing_requests (
    id UUID DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    pairing_code CHAR(8) NOT NULL,
    poll_token_sha256 CHAR(64) NOT NULL,
    device_id VARCHAR(128) NOT NULL,
    device_model VARCHAR(128),
    status VARCHAR(16) NOT NULL DEFAULT 'pending',
    user_id UUID REFERENCES public."user"(id) ON DELETE CASCADE,
    api_key_id TEXT,
    api_key_encrypted TEXT,
    api_key_iv TEXT,
    api_key_tag TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT watch_pairing_requests_status CHECK (status IN ('pending', 'claimed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_pairing_requests_code
    ON public.watch_pairing_requests(pairing_code);

CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_pairing_requests_poll_token
    ON public.watch_pairing_requests(poll_token_sha256);

CREATE INDEX IF NOT EXISTS idx_watch_pairing_requests_expires
    ON public.watch_pairing_requests(expires_at);
