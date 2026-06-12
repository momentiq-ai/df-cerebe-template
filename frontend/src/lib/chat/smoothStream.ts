/**
 * Smooth streaming — a requestAnimationFrame token buffer (docs/design §6.2).
 *
 * Tokens often arrive in bursts faster than the screen refreshes. Pushing each
 * one straight to reactive state causes re-render churn and a jittery "typing"
 * feel. Instead we buffer incoming text and flush the accumulated string to the
 * renderer at most once per animation frame (~60fps), and flush synchronously on
 * end. This is the single biggest perceived-quality win and is framework-agnostic.
 */
export class SmoothStreamer {
  private pending = "";
  private full = "";
  private raf = 0;

  /** @param onUpdate called with the full accumulated text, throttled to rAF. */
  constructor(private onUpdate: (full: string) => void) {}

  /** Queue a text delta; schedules a flush on the next animation frame. */
  push(chunk: string): void {
    if (!chunk) return;
    this.pending += chunk;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.flush());
  }

  /** Move buffered text into the rendered string and notify. */
  private flush(): void {
    this.raf = 0;
    if (!this.pending) return;
    this.full += this.pending;
    this.pending = "";
    this.onUpdate(this.full);
  }

  /** Flush any remainder immediately (call on stream end). */
  done(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
    if (this.pending) {
      this.full += this.pending;
      this.pending = "";
    }
    this.onUpdate(this.full);
  }
}
