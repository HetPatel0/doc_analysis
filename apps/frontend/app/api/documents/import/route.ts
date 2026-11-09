import { NextResponse } from "next/server";

import { rateLimit } from "@/lib/server/rate-limit";
import {
  applyActorCookies,
  importDocumentForActor,
  resolveActor,
} from "@/lib/server/workspace";
import { isValidImportUrl } from "@/lib/upload";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request, { withWorkspace: false });
    const retryAfter = rateLimit(actor, "upload");

    if (retryAfter) {
      return applyActorCookies(
        actor,
        NextResponse.json(
          { detail: "Too many imports. Try again shortly." },
          { status: 429, headers: { "Retry-After": String(retryAfter) } }
        )
      );
    }

    const body = (await request.json().catch(() => null)) as {
      url?: string;
    } | null;

    if (!body?.url) {
      return NextResponse.json(
        { detail: "Paste a URL to import." },
        { status: 400 }
      );
    }

    const validationError = isValidImportUrl(body.url);
    if (validationError) {
      return NextResponse.json({ detail: validationError }, { status: 400 });
    }

    const response = NextResponse.json(
      await importDocumentForActor(actor, body.url)
    );
    return applyActorCookies(actor, response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not import that URL.";
    const status = /Guest mode/.test(message) ? 403 : 502;

    return NextResponse.json({ detail: message }, { status });
  }
}
