import { NextResponse } from "next/server";

import {
  applyActorCookies,
  resolveActor,
  streamChatForActor,
} from "@/lib/server/workspace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    const body = (await request.json()) as {
      documentId?: string;
      message?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    };

    if (!body.documentId || !body.message) {
      return NextResponse.json(
        { detail: "Document and message are required." },
        { status: 400 }
      );
    }

    const stream = await streamChatForActor(
      actor,
      body.documentId,
      body.message,
      body.history ?? []
    );
    const response = new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
    return applyActorCookies(actor, response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not send the message.";
    const status =
      /all 3 guest chats|not found for this workspace/i.test(message) ? 403 : 500;

    return NextResponse.json({ detail: message }, { status });
  }
}
