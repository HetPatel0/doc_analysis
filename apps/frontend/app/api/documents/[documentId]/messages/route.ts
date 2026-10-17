import { NextResponse } from "next/server";

import {
  applyActorCookies,
  listMessagesForActor,
  resolveActor,
  saveMessageForActor,
} from "@/lib/server/workspace";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await resolveActor(request);
    const { documentId } = await context.params;
    const response = NextResponse.json({
      messages: await listMessagesForActor(actor, documentId),
    });
    return applyActorCookies(actor, response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not load messages.";
    const status = /not found for this workspace/i.test(message) ? 403 : 500;

    return NextResponse.json({ detail: message }, { status });
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await resolveActor(request);
    const { documentId } = await context.params;
    const body = (await request.json()) as {
      role?: string;
      content?: string;
    };

    if (
      (body.role !== "user" && body.role !== "assistant") ||
      !body.content?.trim()
    ) {
      return NextResponse.json(
        { detail: "Role and content are required." },
        { status: 400 }
      );
    }

    const response = NextResponse.json({
      message: await saveMessageForActor(
        actor,
        documentId,
        body.role,
        body.content
      ),
    });
    return applyActorCookies(actor, response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not save message.";
    const status = /not found for this workspace/i.test(message) ? 403 : 500;

    return NextResponse.json({ detail: message }, { status });
  }
}
