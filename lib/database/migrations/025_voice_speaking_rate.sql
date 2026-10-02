-- Adjustable speaking speed for the AI's voice (AI Employee -> Voice).
-- ElevenLabs' voice_settings.speed accepts 0.7-1.2 (1.0 = normal); this
-- mirrors that exact range with a CHECK constraint so a bad value can
-- never reach their API and come back as a 400 mid-call. Defaults every
-- existing business to 1.0 (unchanged current behavior) on this
-- migration's own insert/update, and every new business via its column
-- default going forward.
ALTER TABLE ai_voice_configs
  ADD COLUMN IF NOT EXISTS speaking_rate numeric NOT NULL DEFAULT 1.0
    CHECK (speaking_rate >= 0.7 AND speaking_rate <= 1.2);
