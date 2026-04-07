import Link from "next/link";

export default function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-lg border border-border bg-card text-sm font-semibold text-foreground">
            B
          </span>
          <div className="flex flex-col leading-none">
            <span className="text-sm font-semibold tracking-[-0.02em] text-foreground">
              Bookify
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              PDF chat workspace
            </span>
          </div>
        </Link>

        <div className="hidden rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground sm:block">
          Single document mode
        </div>
      </div>
    </header>
  );
}
