/**
 * TTS API tests. Auth middleware is mocked so we can test validation and 500 without a real JWT.
 */

import request from "supertest";
import { app } from "../../app";

jest.mock("../../middleware/auth", () => ({
  ...jest.requireActual("../../middleware/auth"),
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.userId = "test-user-id";
    next();
  },
}));

describe("POST /api/tts/stream", () => {
  const originalOpenAiKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalOpenAiKey;
  });

  it("returns 400 when text is missing", async () => {
    const res = await request(app)
      .post("/api/tts/stream")
      .set("Content-Type", "application/json")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Text is required.");
  });

  it("returns 400 when text is empty string", async () => {
    const res = await request(app)
      .post("/api/tts/stream")
      .set("Content-Type", "application/json")
      .send({ text: "   " });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error", "Text is required.");
  });

  it("returns 400 when text exceeds MAX_TTS_CHARS", async () => {
    const longText = "a".repeat(501);
    const res = await request(app)
      .post("/api/tts/stream")
      .set("Content-Type", "application/json")
      .send({ text: longText });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("too long");
    expect(res.body.error).toContain("500");
  });

  it("returns 500 when OPENAI_API_KEY is not set", async () => {
    process.env.OPENAI_API_KEY = "";
    const res = await request(app)
      .post("/api/tts/stream")
      .set("Content-Type", "application/json")
      .send({ text: "Hello world" });

    expect(res.status).toBe(500);
    expect(res.body).toHaveProperty("error");
    expect(res.body.error).toContain("OPENAI_API_KEY");
  });
});

describe("GET /api/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
    expect(res.body).toHaveProperty("database");
  });
});
