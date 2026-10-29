import { NextResponse } from "next/server";

import {
  applyActorCookies,
  getDocumentFileForActor,
  resolveActor,
} from "@/lib/server/workspace";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await resolveActor(request);
    const { documentId } = await context.params;
    const file = await getDocumentFileForActor(actor, documentId);

    const headers = new Headers({
      "Content-Type": "application/pdf",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
    });
    if (file.contentLength) {
      headers.set("Content-Length", file.contentLength);
    }

    return applyActorCookies(actor, new NextResponse(file.body, { headers }));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load the PDF.";
    const status = /not found for this workspace/i.test(message) ? 403 : 500;

    return NextResponse.json({ detail: message }, { status });
  }
}
