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
    const actor = await resolveActor(request, { withWorkspace: false });
    const { documentId } = await context.params;
    const file = await getDocumentFileForActor(
      actor,
      documentId,
      request.headers.get("range"),
      request.headers.get("if-range")
    );

    const headers = new Headers();
    for (const name of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "content-disposition",
      "etag",
      "last-modified",
      "cache-control",
    ]) {
      const value = file.headers.get(name);
      if (value) {
        headers.set(name, value);
      }
    }

    // Preserve the upstream 206/416 status and range headers so PDF.js can
    // stream the first pages instead of downloading the whole file.
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/pdf");
    }
    if (!headers.has("content-disposition")) {
      headers.set("content-disposition", "inline");
    }
    if (!headers.has("accept-ranges")) {
      headers.set("accept-ranges", "bytes");
    }
    if (!headers.has("cache-control")) {
      headers.set("cache-control", "private, max-age=3600");
    }

    return applyActorCookies(
      actor,
      new NextResponse(file.body, { status: file.status, headers })
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load the PDF.";
    const status = /not found for this workspace/i.test(message) ? 403 : 500;

    return NextResponse.json({ detail: message }, { status });
  }
}
