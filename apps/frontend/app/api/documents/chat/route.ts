import { NextResponse } from "next/server";

import {
  applyActorCookies,
  chatWithDocumentForActor,
  resolveActor,
} from "@/lib/server/workspace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    const body = (await request.json()) as {
      documentId?: string;
      message?: string;
    };

    if (!body.documentId || !body.message) {
      return NextResponse.json(
        { detail: "Document and message are required." },
        { status: 400 }
      );
    }

    const response = NextResponse.json(
      await chatWithDocumentForActor(actor, body.documentId, body.message)
    );
    return applyActorCookies(actor, response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not send the message.";
    const status =
      /all 3 guest chats|not found for this workspace/i.test(message) ? 403 : 500;

    return NextResponse.json({ detail: message }, { status });
  }
}
