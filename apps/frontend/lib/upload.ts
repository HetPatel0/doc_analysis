import type { UploadDocumentResponse } from "@/lib/workspace-types";

export const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB ?? 20);
export const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

export function validatePdfFile(file: File): string | null {
  const looksLikePdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

  if (!looksLikePdf) {
    return "Only PDF files are supported.";
  }
  if (file.size === 0) {
    return "That file is empty.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `PDF must be ${MAX_UPLOAD_MB}MB or smaller.`;
  }

  return null;
}

export type UploadResult = UploadDocumentResponse & { detail?: string };

export function uploadPdfWithProgress(
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
        reject(new Error(payload.detail ?? "Could not upload the PDF."));
      }
    });

    request.addEventListener("error", () => {
      reject(
        new Error(
          "Could not upload the PDF. Check your connection and try again."
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
