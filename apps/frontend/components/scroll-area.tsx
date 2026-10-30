"use client";

import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from "react";

import { cn } from "@/lib/utils";

type ScrollAreaProps = {
  children: ReactNode;
  className?: string;
  viewportClassName?: string;
  viewportRef?: RefObject<HTMLDivElement | null>;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
};

const TRACK_INSET = 6;
const MIN_THUMB = 28;
const IDLE_MS = 750;

type Flags = {
  hovering: boolean;
  scrolling: boolean;
  dragging: boolean;
};

type Metrics = {
  maxTop: number;
  scrollable: number;
};

/**
 * Pure painting routine so the component never has to memoize a callback that
 * reaches into `ref.current` (which the React Compiler cannot preserve).
 */
function paintScrollbar(
  element: HTMLDivElement | null,
  thumb: HTMLDivElement | null,
  flags: Flags,
  metrics: Metrics
) {
  if (!element || !thumb) {
    return;
  }

  const scrollable = element.scrollHeight - element.clientHeight;
  const trackHeight = Math.max(0, element.clientHeight - TRACK_INSET * 2);
  const ratio =
    element.scrollHeight > 0 ? element.clientHeight / element.scrollHeight : 1;
  const thumbHeight = Math.min(
    trackHeight,
    Math.max(MIN_THUMB, Math.round(trackHeight * ratio))
  );
  const maxTop = Math.max(0, trackHeight - thumbHeight);
  const progress = scrollable > 0 ? element.scrollTop / scrollable : 0;
  const top = TRACK_INSET + Math.min(1, Math.max(0, progress)) * maxTop;

  metrics.maxTop = maxTop;
  metrics.scrollable = scrollable;

  thumb.style.height = `${thumbHeight}px`;
  thumb.style.transform = `translateY(${top}px)`;

  const active =
    scrollable > 1 && (flags.hovering || flags.scrolling || flags.dragging);

  thumb.style.opacity = active ? "1" : "0";
  thumb.style.pointerEvents = active ? "auto" : "none";
}

/**
 * A scroll container with a slim overlay thumb that never reserves layout
 * space. Native scrollbars are hidden globally, so content width stays stable
 * (a changing gutter is what made the PDF canvas resize and flicker).
 */
export function ScrollArea({
  children,
  className,
  viewportClassName,
  viewportRef,
  onScroll,
}: ScrollAreaProps) {
  const fallbackRef = useRef<HTMLDivElement>(null);
  const viewport = viewportRef ?? fallbackRef;
  const thumbRef = useRef<HTMLDivElement>(null);
  const flags = useRef<Flags>({
    hovering: false,
    scrolling: false,
    dragging: false,
  });
  const idleTimer = useRef<number | null>(null);
  const dragState = useRef<{
    startY: number;
    startScrollTop: number;
    maxTop: number;
    scrollable: number;
  } | null>(null);
  const metrics = useRef<Metrics>({ maxTop: 0, scrollable: 0 });

  function paint() {
    paintScrollbar(viewport.current, thumbRef.current, flags.current, metrics.current);
  }

  useEffect(() => {
    const element = viewport.current;

    if (!element) {
      return;
    }

    paintScrollbar(element, thumbRef.current, flags.current, metrics.current);

    const resizeObserver = new ResizeObserver(() => {
      paintScrollbar(element, thumbRef.current, flags.current, metrics.current);
    });
    resizeObserver.observe(element);

    const mutationObserver = new MutationObserver(() => {
      paintScrollbar(element, thumbRef.current, flags.current, metrics.current);
    });
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    const onWindowResize = () => {
      paintScrollbar(element, thumbRef.current, flags.current, metrics.current);
    };
    window.addEventListener("resize", onWindowResize);

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [viewport]);

  useEffect(() => {
    return () => {
      if (idleTimer.current) {
        window.clearTimeout(idleTimer.current);
      }
    };
  }, []);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    onScroll?.(event);

    flags.current.scrolling = true;
    paint();

    if (idleTimer.current) {
      window.clearTimeout(idleTimer.current);
    }

    idleTimer.current = window.setTimeout(() => {
      flags.current.scrolling = false;
      paint();
    }, IDLE_MS);
  }

  function handlePointerEnter() {
    flags.current.hovering = true;
    paint();
  }

  function handlePointerLeave() {
    flags.current.hovering = false;
    if (!flags.current.dragging) {
      paint();
    }
  }

  function handleThumbPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    const element = viewport.current;

    if (!element) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    flags.current.dragging = true;
    dragState.current = {
      startY: event.clientY,
      startScrollTop: element.scrollTop,
      maxTop: metrics.current.maxTop,
      scrollable: metrics.current.scrollable,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    paint();
  }

  function handleThumbPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const element = viewport.current;
    const state = dragState.current;

    if (!flags.current.dragging || !element || !state) {
      return;
    }

    const delta = event.clientY - state.startY;
    const ratio = state.maxTop > 0 ? state.scrollable / state.maxTop : 0;
    element.scrollTo({ top: state.startScrollTop + delta * ratio });
    paint();
  }

  function handleThumbPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    flags.current.dragging = false;
    dragState.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    paint();
  }

  return (
    <div
      className={cn("relative min-h-0 min-w-0", className)}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <div
        ref={viewport}
        onScroll={handleScroll}
        className={cn(
          "scrollbar-none h-full w-full overflow-y-auto overflow-x-hidden overscroll-contain",
          viewportClassName
        )}
      >
        {children}
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 z-20 w-[9px]"
      >
        <div
          ref={thumbRef}
          onPointerDown={handleThumbPointerDown}
          onPointerMove={handleThumbPointerMove}
          onPointerUp={handleThumbPointerUp}
          onPointerCancel={handleThumbPointerUp}
          className="absolute inset-x-0 top-0 cursor-grab touch-none opacity-0 transition-opacity duration-200 active:cursor-grabbing"
        >
          <div className="ml-auto h-full w-[3px] bg-foreground/30 transition-colors hover:bg-foreground/50" />
        </div>
      </div>
    </div>
  );
}
