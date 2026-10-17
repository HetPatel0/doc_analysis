"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { LoaderCircle, UploadCloud } from "lucide-react";

import { validatePdfFile } from "@/lib/upload";
import { cn } from "@/lib/utils";

type PdfDropzoneProps = {
  onFile: (file: File) => void;
  onInvalid?: (message: string) => void;
  disabled?: boolean;
  isUploading?: boolean;
  progress?: number;
  className?: string;
  children: ReactNode;
};

export function PdfDropzone({
  onFile,
  onInvalid,
  disabled = false,
  isUploading = false,
  progress = 0,
  className,
  children,
}: PdfDropzoneProps) {
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (disabled) {
      return;
    }
    dragDepth.current += 1;
    setIsDragging(true);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setIsDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);

    if (disabled) {
      return;
    }

    const file = event.dataTransfer.files?.[0];
    if (!file) {
      return;
    }

    const validationError = validatePdfFile(file);
    if (validationError) {
      onInvalid?.(validationError);
      return;
    }

    onFile(file);
  }

  const showOverlay = isDragging && !disabled;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn("relative", className)}
    >
      {children}

      {showOverlay ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-[1.75rem] border-2 border-dashed border-primary/60 bg-background/85 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2 text-center">
            <UploadCloud className="size-7 text-primary" />
            <p className="text-sm font-medium text-foreground">Drop your PDF here</p>
          </div>
        </div>
      ) : null}

      {isUploading ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-4 sm:px-5">
          <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-sm">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <LoaderCircle className="size-3 animate-spin" />
                Uploading PDF
              </span>
              <span>{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
