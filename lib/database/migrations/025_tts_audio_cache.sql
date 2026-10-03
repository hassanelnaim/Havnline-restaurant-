-- Caches synthesized ElevenLabs audio for a small, FIXED set of lines
-- the AI repeats verbatim on every call (the filler lines it says
-- while a slow tool runs, plus boilerplate like "Thanks for calling.
-- Goodbye.") — see lib/ai/twimlHelpers.ts's STATIC_TTS_LINES and
-- lib/integrations/telephony/ttsCache.ts.
--
-- Deliberately does NOT cache the AI's actual dynamic replies (order
-- read-backs, anything with a name/phone/total in it) — only text in
-- the fixed allow-list is ever looked up or written here, so this
-- table never ends up holding synthesized speech of a customer's own
-- words.
--
-- One row per (voice, exact text) pair. Keyed by a hash of the text
-- rather than the text itself so the primary key stays a fixed, small
-- size regardless of line length.
create table if not exists tts_audio_cache (
  id uuid primary key default gen_random_uuid(),
  eleven_voice_id text not null,
  text_hash text not null,
  -- Stored as base64 text, not bytea — these clips are tiny (a few KB)
  -- and this keeps the row trivially readable/portable without a
  -- separate binary-safe code path.
  audio_base64 text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists tts_audio_cache_voice_text_idx on tts_audio_cache(eleven_voice_id, text_hash);
