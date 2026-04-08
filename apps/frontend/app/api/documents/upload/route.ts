import { NextResponse } from "next/server";

import {
  applyActorCookies,
  resolveActor,
  uploadDocumentForActor,
} from "@/lib/server/workspace";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const actor = await resolveActor(request);
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ detail: "PDF file is required." }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json(
        { detail: "Only PDF files are allowed." },
        { status: 400 }
      );
    }

    const response = NextResponse.json(await uploadDocumentForActor(actor, file));
    return applyActorCookies(actor, response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not upload the document.";
    const status = /Guest mode/.test(message) ? 403 : 500;

    return NextResponse.json({ detail: message }, { status });
  }
}
