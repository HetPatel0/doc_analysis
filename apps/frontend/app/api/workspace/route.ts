import { NextResponse } from "next/server";

import {
  applyActorCookies,
  buildWorkspaceState,
  resolveActor,
  selectActiveDocumentForActor,
} from "@/lib/server/workspace";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = await resolveActor(request);
    const response = NextResponse.json(buildWorkspaceState(actor));
    return applyActorCookies(actor, response);
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          error instanceof Error ? error.message : "Could not load workspace.",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    const body = (await request.json()) as { documentId?: string };

    if (!body.documentId) {
      return NextResponse.json(
        { detail: "A documentId is required." },
        { status: 400 }
      );
    }

    const response = NextResponse.json(
      await selectActiveDocumentForActor(actor, body.documentId)
    );
    return applyActorCookies(actor, response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not switch documents.";
    const status = /not found for this workspace/i.test(message) ? 403 : 500;

    return NextResponse.json({ detail: message }, { status });
  }
}
