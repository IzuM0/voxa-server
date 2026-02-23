/**
 * Database Type Definitions
 * These types match the PostgreSQL schema defined in migrations/001_initial_schema.sql
 */

export type MeetingStatus = "scheduled" | "active" | "completed" | "cancelled";
export type TTSMessageStatus = "pending" | "sent" | "failed";
export type Platform = "google-meet" | "zoom" | "microsoft-teams" | "other";
export type Voice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

/**
 * Meeting record from database
 */
export interface Meeting {
  id: string; // UUID
  user_id: string; // UUID - references Supabase auth.users(id)
  title: string;
  platform: Platform;
  scheduled_at: Date | null;
  started_at: Date | null;
  ended_at: Date | null;
  duration: number | null; // Duration in seconds
  status: MeetingStatus;
  meeting_url: string | null;
  language: string | null; // Language code (e.g., 'en-US')
  created_at: Date;
  updated_at: Date;
}

/**
 * TTS Message record from database
 */
export interface TTSMessage {
  id: string; // UUID
  user_id: string; // UUID - references Supabase auth.users(id)
  meeting_id: string | null; // UUID - optional reference to meetings(id)
  text_input: string;
  text_length: number;
  voice_used: Voice;
  language: string | null; // Language code (e.g., 'en-US')
  speed: number; // Speed multiplier (0.5 to 2.0)
  pitch: number; // Pitch multiplier (0.5 to 2.0)
  status: TTSMessageStatus;
  error_message: string | null;
  audio_duration_seconds: number; // Duration of generated audio in seconds (0 if unknown)
  created_at: Date;
}

/**
 * User Settings record from database
 */
export interface UserSettings {
  user_id: string; // UUID - references Supabase auth.users(id)
  preferred_voice: Voice;
  default_speed: number; // Speed multiplier (0.5 to 2.0)
  default_pitch: number; // Pitch multiplier (0.5 to 2.0)
  default_language: string; // Language code (e.g., 'en-US')
  created_at: Date;
  updated_at: Date;
}

/**
 * Input types for creating/updating records
 */
export interface CreateMeetingInput {
  title: string;
  platform: Platform;
  scheduled_at?: Date | string | null;
  meeting_url?: string | null;
  language?: string | null;
}

export interface UpdateMeetingInput {
  title?: string;
  platform?: Platform;
  scheduled_at?: Date | string | null;
  started_at?: Date | string | null;
  ended_at?: Date | string | null;
  duration?: number | null;
  status?: MeetingStatus;
  meeting_url?: string | null;
  language?: string | null;
}

export interface CreateTTSMessageInput {
  meeting_id?: string | null;
  text_input: string;
  voice_used?: Voice;
  language?: string | null;
  speed?: number;
  pitch?: number;
}

export interface UpdateUserSettingsInput {
  preferred_voice?: Voice;
  default_speed?: number;
  default_pitch?: number;
  default_language?: string;
}

/**
 * Database query result types
 */
export interface MeetingWithStats extends Meeting {
  tts_count?: number;
  total_characters?: number;
}

export interface TTSMessageWithMeeting extends TTSMessage {
  meeting_title?: string | null;
}

/**
 * Analytics/aggregation types
 */
export interface UsageStats {
  total_meetings: number;
  total_tts_messages: number;
  total_characters: number;
  total_duration_seconds: number;
  average_meeting_duration_seconds: number;
}

export interface PlatformStats {
  platform: Platform;
  count: number;
  percentage: number;
}

export interface VoiceStats {
  voice: Voice;
  count: number;
}

export interface MonthlyUsage {
  month: string; // Format: 'YYYY-MM'
  meetings: number;
  characters: number;
}
