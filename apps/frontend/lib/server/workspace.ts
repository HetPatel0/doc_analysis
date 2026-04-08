import { createHash } from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";
import { cookies } from "next/headers";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { documents, usageSubjects } from "@/lib/db/schema";
import {
  GUEST_CHAT_LIMIT,
  GUEST_UPLOAD_LIMIT,
  type ChatDocumentResponse,
  type DocumentSummary,
  type UploadDocumentResponse,
  type WorkspaceState,
} from "@/lib/workspace-types";

const BACKEND_API_URL =
  process.env.BACKEND_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:8000";

const GUEST_COOKIE_NAME = "bookify_guest";

type SessionData = Awaited<ReturnType<typeof auth.api.getSession>>;

type UsageRow = typeof usageSubjects.$inferSelect;
type DocumentRow = typeof documents.$inferSelect;

export type ActorContext = {
  type: "guest" | "user";
  ownerId: string;
  session: SessionData;
  usage: UsageRow | null;
  activeDocument: DocumentRow | null;
  guestCookie: string | null;
  shouldSetGuestCookie: boolean;
};

type BackendStatusResponse = {
  document_id: string;
  file_name: string;
  status: "queued" | "indexing" | "ready" | "failed";
  chunks_indexed?: number | null;
  error?: string | null;
  detail?: string;
};

type BackendUploadResponse = {
  document_id: string;
  file_name: string;
  status: "queued";
  detail?: string;
};

type BackendChatResponse = {
  answer: string;
  detail?: string;
};

function hashFingerprint(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = headers.get("x-real-ip");
  const userAgent = headers.get("user-agent") ?? "unknown";
  const language = headers.get("accept-language") ?? "unknown";

  return createHash("sha256")
    .update([forwardedFor ?? realIp ?? "unknown", userAgent, language].join("|"))
    .digest("hex");
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function findLatestDocument(
  ownerType: "guest" | "user",
  ownerId: string
): Promise<DocumentRow | null> {
  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.ownerType, ownerType), eq(documents.ownerId, ownerId)))
    .orderBy(desc(documents.createdAt))
    .limit(1);

  return document ?? null;
}

async function findUsage(
  ownerType: "guest" | "user",
  ownerId: string
): Promise<UsageRow | null> {
  const [usage] = await db
    .select()
    .from(usageSubjects)
    .where(
      and(eq(usageSubjects.ownerType, ownerType), eq(usageSubjects.ownerId, ownerId))
    )
    .limit(1);

  return usage ?? null;
}

async function ensureUsage(
  ownerType: "guest" | "user",
  ownerId: string,
  fingerprintHash?: string
): Promise<UsageRow> {
  const existing = await findUsage(ownerType, ownerId);

  if (existing) {
    if (
      ownerType === "guest" &&
      fingerprintHash &&
      existing.fingerprintHash !== fingerprintHash
    ) {
      const [updated] = await db
        .update(usageSubjects)
        .set({ fingerprintHash, updatedAt: new Date() })
        .where(eq(usageSubjects.id, existing.id))
        .returning();

      return updated;
    }

    return existing;
  }

  const [created] = await db
    .insert(usageSubjects)
    .values({
      ownerType,
      ownerId,
      fingerprintHash: ownerType === "guest" ? fingerprintHash ?? null : null,
    })
    .returning();

  return created;
}

async function claimGuestResources(guestId: string, userId: string) {
  const guestUsage = await findUsage("guest", guestId);

  if (!guestUsage) {
    await db
      .update(documents)
      .set({
        ownerType: "user",
        ownerId: userId,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.ownerType, "guest"), eq(documents.ownerId, guestId)));
    return;
  }

  const userUsage = await findUsage("user", userId);

  if (userUsage) {
    await db
      .update(usageSubjects)
      .set({
        uploadCount: sql`${usageSubjects.uploadCount} + ${guestUsage.uploadCount}`,
        chatCount: sql`${usageSubjects.chatCount} + ${guestUsage.chatCount}`,
        updatedAt: new Date(),
      })
      .where(eq(usageSubjects.id, userUsage.id));
  } else {
    await db.insert(usageSubjects).values({
      ownerType: "user",
      ownerId: userId,
      uploadCount: guestUsage.uploadCount,
      chatCount: guestUsage.chatCount,
    });
  }

  await db
    .update(documents)
    .set({
      ownerType: "user",
      ownerId: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(documents.ownerType, "guest"), eq(documents.ownerId, guestId)));
}

export async function resolveActor(request: Request): Promise<ActorContext> {
  const session = await auth.api.getSession({ headers: request.headers });
  const cookieStore = await cookies();
  const guestCookie = cookieStore.get(GUEST_COOKIE_NAME)?.value ?? null;
  const fingerprintHash = hashFingerprint(request.headers);

  if (session?.user?.id) {
    if (guestCookie) {
      await claimGuestResources(guestCookie, session.user.id);
    }

    const usage = await ensureUsage("user", session.user.id);
    const activeDocument = await findLatestDocument("user", session.user.id);

    return {
      type: "user",
      ownerId: session.user.id,
      session,
      usage,
      activeDocument,
      guestCookie,
      shouldSetGuestCookie: false,
    };
  }

  let resolvedGuestId = guestCookie;

  if (!resolvedGuestId) {
    const [fingerprintMatch] = await db
      .select()
      .from(usageSubjects)
      .where(
        and(
          eq(usageSubjects.ownerType, "guest"),
          eq(usageSubjects.fingerprintHash, fingerprintHash)
        )
      )
      .limit(1);

    resolvedGuestId = fingerprintMatch?.ownerId ?? crypto.randomUUID();
  }

  const usage = await ensureUsage("guest", resolvedGuestId, fingerprintHash);
  const activeDocument = await findLatestDocument("guest", resolvedGuestId);

  return {
    type: "guest",
    ownerId: resolvedGuestId,
    session: null,
    usage,
    activeDocument,
    guestCookie: resolvedGuestId,
    shouldSetGuestCookie: guestCookie !== resolvedGuestId,
  };
}

export function applyActorCookies(
  actor: ActorContext,
  response: Response & {
    cookies?: {
      set: (name: string, value: string, options: Record<string, unknown>) => void;
    };
  }
) {
  if (actor.type !== "guest" || !actor.shouldSetGuestCookie || !actor.guestCookie) {
    return response;
  }

  response.cookies?.set(GUEST_COOKIE_NAME, actor.guestCookie, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}

export function toDocumentSummary(document: DocumentRow | null): DocumentSummary | null {
  if (!document) {
    return null;
  }

  return {
    documentId: document.documentId,
    fileName: document.fileName,
    status: document.status,
    chunksIndexed: document.chunksIndexed,
    chatsUsed: document.chatsUsed,
    createdAt: document.createdAt.toISOString(),
  };
}

export function buildWorkspaceState(actor: ActorContext): WorkspaceState {
  const chatCount = actor.usage?.chatCount ?? 0;
  const uploadCount = actor.usage?.uploadCount ?? 0;

  return {
    viewer: {
      isAuthenticated: actor.type === "user",
      name: actor.session?.user?.name ?? null,
      email: actor.session?.user?.email ?? null,
    },
    limits: {
      maxChats: actor.type === "guest" ? GUEST_CHAT_LIMIT : null,
      remainingChats:
        actor.type === "guest" ? Math.max(0, GUEST_CHAT_LIMIT - chatCount) : null,
      chatsUsed: chatCount,
      uploadCount,
      uploadAllowed:
        actor.type === "guest" ? uploadCount < GUEST_UPLOAD_LIMIT : true,
      limitReached: actor.type === "guest" ? chatCount >= GUEST_CHAT_LIMIT : false,
    },
    activeDocument: toDocumentSummary(actor.activeDocument),
  };
}

export async function assertDocumentOwnership(
  actor: ActorContext,
  documentId: string
): Promise<DocumentRow> {
  const [document] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.documentId, documentId),
        eq(documents.ownerType, actor.type),
        eq(documents.ownerId, actor.ownerId)
      )
    )
    .limit(1);

  if (!document) {
    throw new Error("Document not found for this workspace.");
  }

  return document;
}

export async function uploadDocumentForActor(
  actor: ActorContext,
  file: File
): Promise<UploadDocumentResponse> {
  if (actor.type === "guest" && (actor.usage?.uploadCount ?? 0) >= GUEST_UPLOAD_LIMIT) {
    throw new Error("Guest mode supports one PDF. Log in to upload more.");
  }

  const formData = new FormData();
  formData.append("file", file);

  const backendResponse = await fetch(`${BACKEND_API_URL}/upload`, {
    method: "POST",
    body: formData,
  });

  const result = await readJson<BackendUploadResponse>(backendResponse);

  if (!backendResponse.ok || !result.document_id) {
    throw new Error(result.detail ?? "Upload failed.");
  }

  const [document] = await db
    .insert(documents)
    .values({
      documentId: result.document_id,
      ownerType: actor.type,
      ownerId: actor.ownerId,
      fileName: result.file_name,
      status: "queued",
    })
    .returning();

  await db
    .update(usageSubjects)
    .set({
      uploadCount: sql`${usageSubjects.uploadCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(usageSubjects.ownerType, actor.type),
        eq(usageSubjects.ownerId, actor.ownerId)
      )
    );

  return {
    document: toDocumentSummary(document)!,
  };
}

export async function syncDocumentStatus(
  actor: ActorContext,
  documentId: string
): Promise<DocumentSummary> {
  await assertDocumentOwnership(actor, documentId);

  const backendResponse = await fetch(`${BACKEND_API_URL}/documents/${documentId}`, {
    cache: "no-store",
  });
  const result = await readJson<BackendStatusResponse>(backendResponse);

  if (!backendResponse.ok || !result.status) {
    throw new Error(result.detail ?? "Could not fetch document status.");
  }

  const [updated] = await db
    .update(documents)
    .set({
      status: result.status,
      fileName: result.file_name,
      chunksIndexed: result.chunks_indexed ?? null,
      updatedAt: new Date(),
    })
    .where(eq(documents.documentId, documentId))
    .returning();

  return toDocumentSummary(updated)!;
}

export async function chatWithDocumentForActor(
  actor: ActorContext,
  documentId: string,
  message: string
): Promise<ChatDocumentResponse> {
  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    throw new Error("Message is required.");
  }

  await assertDocumentOwnership(actor, documentId);

  const currentChatCount = actor.usage?.chatCount ?? 0;

  if (actor.type === "guest" && currentChatCount >= GUEST_CHAT_LIMIT) {
    throw new Error("You have used all 3 guest chats. Log in to continue.");
  }

  const backendResponse = await fetch(`${BACKEND_API_URL}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      document_id: documentId,
      message: trimmedMessage,
    }),
  });

  const result = await readJson<BackendChatResponse>(backendResponse);

  if (!backendResponse.ok || !result.answer) {
    throw new Error(result.detail ?? "Chat request failed.");
  }

  await db
    .update(usageSubjects)
    .set({
      chatCount: sql`${usageSubjects.chatCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(usageSubjects.ownerType, actor.type),
        eq(usageSubjects.ownerId, actor.ownerId)
      )
    );

  await db
    .update(documents)
    .set({
      chatsUsed: sql`${documents.chatsUsed} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(documents.documentId, documentId));

  return {
    answer: result.answer,
    remainingChats:
      actor.type === "guest"
        ? Math.max(0, GUEST_CHAT_LIMIT - (currentChatCount + 1))
        : null,
  };
}
