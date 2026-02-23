/**
 * TTS service: OpenAI speech generation, MP3→WAV conversion, and DB logging.
 * Used by POST /api/tts/stream; route handles validation, auth, and response.
 */

import { getPool, queryOne } from "../db/index";
import { convertMp3ToWav, getWavDurationSeconds } from "../audio/convertToWav";

export const MAX_TTS_CHARS = 500;

export interface TtsStreamInput {
  text: string;
  voice?: string;
  language?: string;
  speed?: number;
  pitch?: number;
  meeting_id?: string;
}

export interface TtsStreamSuccess {
  wavBuffer: Buffer;
  audioDurationSeconds: number;
}

/** Thrown by generateTtsWav with statusCode and optional details for JSON response */
export class TtsServiceError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: string
  ) {
    super(message);
    this.name = "TtsServiceError";
  }
}

/**
 * Insert a pending TTS message row. If meeting_id is provided, it is not verified here
 * (caller may verify separately). Returns the new row id or null if DB unavailable.
 */
export async function logTtsMessagePending(
  userId: string,
  input: TtsStreamInput
): Promise<string | null> {
  const pool = getPool();
  if (!pool) return null;

  const { text, voice, language, speed, pitch, meeting_id } = input;

  if (meeting_id) {
    const meeting = await queryOne(
      "SELECT id FROM meetings WHERE id = $1 AND user_id = $2",
      [meeting_id, userId]
    );
    if (!meeting && process.env.NODE_ENV === "development") {
      console.warn(`Meeting ${meeting_id} not found for user ${userId}`);
    }
  }

  const result = await queryOne<{ id: string }>(
    `INSERT INTO tts_messages (
      user_id, meeting_id, text_input, text_length, voice_used, language, speed, pitch, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id`,
    [
      userId,
      meeting_id || null,
      text,
      text.length,
      voice || "alloy",
      language || null,
      speed ?? 1.0,
      pitch ?? 1.0,
      "pending",
    ]
  );
  return result?.id ?? null;
}

/**
 * Update TTS message status to failed. Best-effort; does not throw.
 */
export async function updateTtsMessageFailed(
  dbMessageId: string,
  _userId: string,
  errorMessage: string
): Promise<void> {
  try {
    const pool = getPool();
    if (!pool) return;
    await pool.query(
      "UPDATE tts_messages SET status = $1, error_message = $2 WHERE id = $3",
      ["failed", errorMessage.substring(0, 500), dbMessageId]
    );
  } catch {
    // Ignore DB errors
  }
}

/**
 * Update TTS message status to sent and set audio_duration_seconds. Best-effort; does not throw.
 */
export async function updateTtsMessageSent(
  dbMessageId: string,
  _userId: string,
  audioDurationSeconds: number
): Promise<void> {
  try {
    const pool = getPool();
    if (!pool) return;
    await pool.query(
      "UPDATE tts_messages SET status = $1, audio_duration_seconds = $2 WHERE id = $3",
      ["sent", Math.round(audioDurationSeconds), dbMessageId]
    );
  } catch {
    // Ignore DB errors
  }
}

/**
 * Generate WAV audio from text via OpenAI TTS and ffmpeg conversion.
 * Returns buffer and duration on success; throws TtsServiceError on failure.
 */
export async function generateTtsWav(input: TtsStreamInput): Promise<TtsStreamSuccess> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new TtsServiceError(500, "OPENAI_API_KEY is not configured on the server.");
  }

  const { text, voice, language, speed, pitch } = input;

  const instructionsParts: string[] = [];
  if (language) instructionsParts.push(`Speak in ${language}.`);
  if (typeof pitch === "number") {
    instructionsParts.push(`Use a pitch of ${pitch.toFixed(1)}x (best-effort).`);
  }

  const speedNum = typeof speed === "number" ? speed : 1.0;
  const clampedSpeed = Math.min(4, Math.max(0.25, speedNum));

  const upstream = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini-tts",
      voice: voice || "alloy",
      input: text,
      response_format: "mp3",
      speed: clampedSpeed,
      ...(instructionsParts.length > 0 && { instructions: instructionsParts.join(" ") }),
    }),
  });

  if (!upstream.ok) {
    const textBody = await upstream.text().catch(() => "");
    let errorMessage = "TTS provider error";
    let errorDetails = textBody;
    try {
      const errorJson = JSON.parse(textBody);
      if (errorJson.error?.message) {
        errorMessage = errorJson.error.message;
        errorDetails = errorJson.error.message;
      } else if (errorJson.message) {
        errorMessage = errorJson.message;
        errorDetails = errorJson.message;
      }
    } catch {
      if (textBody) {
        errorMessage = textBody.substring(0, 200);
        errorDetails = textBody;
      }
    }
    throw new TtsServiceError(upstream.status, errorMessage, errorDetails);
  }

  if (!upstream.body) {
    throw new TtsServiceError(502, "TTS provider returned no audio stream.");
  }

  const mp3Chunks: Buffer[] = [];
  for await (const chunk of upstream.body as AsyncIterable<Uint8Array>) {
    mp3Chunks.push(Buffer.from(chunk));
  }
  const mp3Buffer = Buffer.concat(mp3Chunks);

  let wavBuffer: Buffer;
  try {
    wavBuffer = await convertMp3ToWav(mp3Buffer);
  } catch (convErr: unknown) {
    const msg = convErr instanceof Error ? convErr.message : String(convErr);
    throw new TtsServiceError(
      503,
      "Audio conversion unavailable.",
      msg || "Install ffmpeg and ensure it is on PATH for 48kHz mono WAV output."
    );
  }

  const audioDurationSeconds = getWavDurationSeconds(wavBuffer);
  return { wavBuffer, audioDurationSeconds };
}
