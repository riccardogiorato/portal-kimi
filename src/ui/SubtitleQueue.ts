export interface SubtitleCue {
  text: string;
  durationSeconds: number;
  speaker?: string;
}

export interface SubtitleQueueHandlers {
  onShow(text: string, speaker?: string): void;
  onHide(): void;
}

/** Queues subtitle cues so they never overlap. */
export class SubtitleQueue {
  private readonly queue: SubtitleCue[] = [];
  private current: { cue: SubtitleCue; remaining: number } | null = null;

  constructor(private readonly handlers: SubtitleQueueHandlers) {}

  enqueue(text: string, durationSeconds?: number, speaker?: string): void {
    const cue: SubtitleCue = {
      text,
      durationSeconds: durationSeconds ?? DEFAULT_DURATION_SECONDS,
      ...(speaker !== undefined ? { speaker } : {}),
    };

    if (!this.current) {
      this.show(cue);
      return;
    }

    this.queue.push(cue);
  }

  tick(dtSeconds: number): void {
    if (!this.current) return;

    this.current.remaining -= dtSeconds;
    if (this.current.remaining <= 0) {
      const next = this.queue.shift();
      if (next) {
        this.show(next);
      } else {
        this.handlers.onHide();
        this.current = null;
      }
    }
  }

  clear(): void {
    this.queue.length = 0;
    this.current = null;
    this.handlers.onHide();
  }

  get isShowing(): boolean {
    return this.current !== null;
  }

  get pendingCount(): number {
    return this.queue.length;
  }

  private show(cue: SubtitleCue): void {
    this.current = { cue, remaining: cue.durationSeconds };
    this.handlers.onShow(cue.text, cue.speaker);
  }
}

const DEFAULT_DURATION_SECONDS = 3;
