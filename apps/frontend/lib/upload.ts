import type {
  SourceKind,
  UploadDocumentResponse,
} from "@/lib/workspace-types";

export const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 20);
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".txt", ".md", ".markdown"];

/**
 * `accept` for file inputs. MIME types keep the picker friendly on mobile while
 * extensions cover browsers that report an empty/odd type for Markdown.
 */
export const SUPPORTED_UPLOAD_ACCEPT = [
  ...SUPPORTED_EXTENSIONS,
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
].join(",");

const MIME_KIND: Record<string, SourceKind> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/x-markdown": "md",
};

export function fileSourceKind(file: File): SourceKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".docx")) return "docx";
  if (name.endsWith(".md") || name.endsWith(".markdown")) return "md";
  if (name.endsWith(".txt")) return "txt";
  return MIME_KIND[file.type] ?? null;
}

export function validateUploadFile(file: File): string | null {
  if (!fileSourceKind(file)) {
    return "Unsupported file type. Use a PDF, DOCX, TXT, or Markdown file.";
  }
  if (file.size === 0) {
    return "That file is empty.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Documents must be ${MAX_UPLOAD_MB}MB or smaller.`;
  }

  return null;
}

export type UploadResult = UploadDocumentResponse & { detail?: string };

export function uploadDocumentWithProgress(
  file: File,
  onProgress: (percent: number) => void
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/documents/upload");

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });

    request.addEventListener("load", () => {
      let payload: UploadResult = {} as UploadResult;
      try {
        payload = JSON.parse(request.responseText) as UploadResult;
      } catch {
        // Non-JSON error body; fall back to a generic message below.
      }

      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve(payload);
      } else {
        reject(new Error(payload.detail ?? "Could not upload the document."));
      }
    });

    request.addEventListener("error", () => {
      reject(
        new Error(
          "Could not upload the document. Check your connection and try again."
        )
      );
    });

    request.addEventListener("abort", () => {
      reject(new Error("Upload cancelled."));
    });

    const formData = new FormData();
    formData.append("file", file);
    request.send(formData);
  });
}

export function isValidImportUrl(value: string): string | null {
  const candidate = value.trim();
  if (!candidate) {
    return "Paste a URL to import.";
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return "That URL is not valid.";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "Only http:// and https:// URLs can be imported.";
  }

  return null;
}

export function importDocumentFromUrl(url: string): Promise<UploadResult> {
  return fetch("/api/documents/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.trim() }),
  }).then(async (response) => {
    let payload: UploadResult = {} as UploadResult;
    try {
      payload = (await response.json()) as UploadResult;
    } catch {
      // Non-JSON error body; fall back to a generic message below.
    }

    if (!response.ok) {
      throw new Error(payload.detail ?? "Could not import that URL.");
    }

    return payload;
  });
}
