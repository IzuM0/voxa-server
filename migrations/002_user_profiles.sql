-- Voxa Database Schema
-- Migration: 002_user_profiles
-- Description: Adds user_profiles table for storing user profile information

-- User Profiles table
-- Stores additional user profile information (name, avatar)
-- Note: Email is managed by Supabase auth.users
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY, -- References Supabase auth.users(id)
  display_name VARCHAR(255), -- User's display name
  avatar_url TEXT, -- URL to user's avatar image
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for user_id (already primary key, but explicit for clarity)
CREATE INDEX IF NOT EXISTS idx_user_profiles_user_id ON user_profiles(user_id);

-- Trigger to automatically update updated_at
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE user_profiles IS 'Stores user profile information (name, avatar). Email is managed by Supabase auth.users';
COMMENT ON COLUMN user_profiles.user_id IS 'References Supabase auth.users(id) - the user who owns this profile';
COMMENT ON COLUMN user_profiles.display_name IS 'User display name (can differ from auth name)';
COMMENT ON COLUMN user_profiles.avatar_url IS 'URL to user avatar image (stored externally, e.g., Supabase Storage)';
