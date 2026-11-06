import { accessCodeRequired, aiConfigured, MODEL } from "@/lib/server/vision";

export const dynamic = "force-dynamic";

/** Tells the UI whether screenshot recognition can run. Never returns secrets. */
export function GET() {
  return Response.json({ ai: aiConfigured(), model: aiConfigured() ? MODEL : null, accessCodeRequired: accessCodeRequired() });
}
