import { NextResponse } from "next/server";

import {
  applyActorCookies,
  getDocumentChunksForActor,
  resolveActor,
} from "@/lib/server/workspace";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await resolveActor(request, { withWorkspace: false });
    const { documentId } = await context.params;
    const chunks = await getDocumentChunksForActor(actor, documentId);

    return applyActorCookies(
      actor,
      NextResponse.json(
        { chunks },
        { headers: { "Cache-Control": "private, no-store" } }
      )
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not load the document text.";
    const status = /not found for this workspace/i.test(message) ? 403 : 500;

    return NextResponse.json({ detail: message }, { status });
  }
}
