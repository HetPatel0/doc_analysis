import { NextResponse } from "next/server";

import { rateLimit } from "@/lib/server/rate-limit";
import {
  applyActorCookies,
  resolveActor,
  retryDocumentForActor,
} from "@/lib/server/workspace";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await resolveActor(request, { withWorkspace: false });
    const retryAfter = rateLimit(actor, "retry");

    if (retryAfter) {
      return applyActorCookies(
        actor,
        NextResponse.json(
          { detail: "Too many retry attempts. Try again shortly." },
          { status: 429, headers: { "Retry-After": String(retryAfter) } }
        )
      );
    }

    const { documentId } = await context.params;
    const response = NextResponse.json(
      await retryDocumentForActor(actor, documentId)
    );
    return applyActorCookies(actor, response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not retry indexing.";
    const status = /not found for this workspace/i.test(message)
      ? 403
      : /already indexed|already in progress/i.test(message)
        ? 409
        : 500;

    return NextResponse.json({ detail: message }, { status });
  }
}
