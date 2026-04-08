import { NextResponse } from "next/server";

import {
  applyActorCookies,
  resolveActor,
  syncDocumentStatus,
} from "@/lib/server/workspace";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const actor = await resolveActor(request);
    const { documentId } = await context.params;
    const response = NextResponse.json(
      await syncDocumentStatus(actor, documentId)
    );
    return applyActorCookies(actor, response);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not fetch document status.";
    const status = /not found for this workspace/i.test(message) ? 403 : 500;

    return NextResponse.json({ detail: message }, { status });
  }
}
