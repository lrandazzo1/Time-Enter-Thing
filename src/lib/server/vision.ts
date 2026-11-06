import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Server-side Claude vision helper. The API key is read from the server environment only and is
 * never sent to the browser. Images are forwarded to Anthropic for this one request and are not
 * stored or logged by this app.
 */

export const MODEL = process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
export const MAX_IMAGE_BYTES = 3.75 * 1024 * 1024; // decoded bytes; keeps requests under typical 4.5 MB host limits
export const ALLOWED_MEDIA = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type AllowedMedia = (typeof ALLOWED_MEDIA)[number];

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim() || process.env.ANTHROPIC_AUTH_TOKEN?.trim());
}

export function accessCodeRequired(): boolean {
  return Boolean(process.env.APP_ACCESS_CODE?.trim());
}

export function checkAccess(req: Request): boolean {
  const code = process.env.APP_ACCESS_CODE?.trim();
  if (!code) return true;
  const given = req.headers.get("x-access-code") ?? "";
  // constant-time-ish comparison
  if (given.length !== code.length) return false;
  let diff = 0;
  for (let i = 0; i < code.length; i++) diff |= given.charCodeAt(i) ^ code.charCodeAt(i);
  return diff === 0;
}

export class VisionError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface ImageInput {
  mediaType: AllowedMedia;
  data: string; // base64, no data: prefix
}

export function validateImage(img: unknown): ImageInput {
  const v = img as { mediaType?: string; data?: string };
  if (!v || typeof v.data !== "string" || typeof v.mediaType !== "string") throw new VisionError("Missing image data.", 400);
  if (!(ALLOWED_MEDIA as readonly string[]).includes(v.mediaType)) throw new VisionError("Images must be PNG, JPEG, WebP or GIF.", 415);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v.data)) throw new VisionError("Image data is not valid base64.", 400);
  if ((v.data.length * 3) / 4 > MAX_IMAGE_BYTES) throw new VisionError("Image is too large (max ~3.7 MB). The app resizes images automatically — try a smaller screenshot.", 413);
  return { mediaType: v.mediaType as AllowedMedia, data: v.data };
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({ maxRetries: 1, timeout: 55_000 });
  return client;
}

/** Send one image + instructions, constrained to a JSON schema. Returns the parsed object. */
export async function extractJson<T>(image: ImageInput, system: string, instructions: string, schema: Record<string, unknown>): Promise<T> {
  if (!aiConfigured()) throw new VisionError("Screenshot recognition is not configured on this server (ANTHROPIC_API_KEY is missing).", 503);
  let response: Anthropic.Beta.Messages.BetaMessage;
  try {
    response = await getClient().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema } },
      system,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
            { type: "text", text: instructions },
          ],
        },
      ],
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new VisionError("The server's Anthropic API key was rejected. Ask the site owner to check ANTHROPIC_API_KEY.", 502);
    if (error instanceof Anthropic.PermissionDeniedError) throw new VisionError("The server's Anthropic API key does not have access to this model.", 502);
    if (error instanceof Anthropic.RateLimitError) throw new VisionError("The AI service is rate-limited right now. Wait a minute and try again.", 429);
    if (error instanceof Anthropic.BadRequestError) throw new VisionError(`The AI service rejected the request: ${error.message}`, 400);
    if (error instanceof Anthropic.APIConnectionError) throw new VisionError("Could not reach the AI service. Try again.", 502);
    if (error instanceof Anthropic.APIError) throw new VisionError(`AI service error (${error.status ?? "unknown"}). Try again.`, 502);
    throw error;
  }
  if (response.stop_reason === "refusal") throw new VisionError("The AI declined to process this image.", 422);
  if (response.stop_reason === "max_tokens") throw new VisionError("The screenshot had too much content to read in one pass — crop it to fewer days and try again.", 422);
  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new VisionError("The AI returned an unreadable result. Try again.", 502);
  }
}
