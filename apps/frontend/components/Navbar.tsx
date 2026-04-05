import Link from "next/link";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl border border-border bg-card text-sm font-semibold text-foreground shadow-sm">
            B
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-tight text-foreground">
              Bookify
            </span>
            <span className="text-xs text-muted-foreground">
              Upload a PDF. Ask better questions.
            </span>
          </div>
        </Link>

        <div className="hidden items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm sm:flex">
          <span className="size-2 rounded-full bg-primary" />
          Ready for PDF chat
        </div>
      </div>
    </header>
  );
}
