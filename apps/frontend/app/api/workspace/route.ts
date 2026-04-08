import { NextResponse } from "next/server";

import {
  applyActorCookies,
  buildWorkspaceState,
  resolveActor,
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
