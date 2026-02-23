-- Voxa Database Schema
-- Migration: 003_add_audio_duration_to_tts_messages
-- Description: Adds audio_duration_seconds to tts_messages for meeting-layer analytics

-- Add column: duration of generated audio in seconds (0 if unknown or not yet set)
ALTER TABLE tts_messages
  ADD COLUMN IF NOT EXISTS audio_duration_seconds INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN tts_messages.audio_duration_seconds IS 'Duration of the generated audio in seconds; 0 if not calculated or not yet updated';
