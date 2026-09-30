import { NextResponse } from "next/server";

import {
  applyActorCookies,
  deleteDocumentForActor,
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

export async function DELETE(
  request: Request,
  context: { params: Promise<{ documentId: string }> }
) {
  try {
    const actor = await resolveActor(request);
    const { documentId } = await context.params;
    await deleteDocumentForActor(actor, documentId);
    return applyActorCookies(
      actor,
      NextResponse.json({ documentId, status: "deleted" })
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not delete document.";
    const status = /not found for this workspace/i.test(message) ? 403 : 500;

    return NextResponse.json({ detail: message }, { status });
  }
}
