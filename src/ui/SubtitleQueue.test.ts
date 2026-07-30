import { describe, it, expect } from 'vitest';
import { SubtitleQueue } from './SubtitleQueue';

describe('SubtitleQueue', () => {
  it('shows the first cue immediately', () => {
    const shown: { text: string; speaker?: string }[] = [];
    const hidden: boolean[] = [];

    const queue = new SubtitleQueue({
      onShow: (text, speaker) => shown.push(speaker === undefined ? { text } : { text, speaker }),
      onHide: () => hidden.push(true),
    });

    queue.enqueue('Welcome', 2, 'GLaDOS');

    expect(queue.isShowing).toBe(true);
    expect(queue.pendingCount).toBe(0);
    expect(shown).toEqual([{ text: 'Welcome', speaker: 'GLaDOS' }]);
    expect(hidden).toEqual([]);
  });

  it('queues cues instead of overlapping', () => {
    const shown: { text: string; speaker?: string }[] = [];
    const queue = new SubtitleQueue({
      onShow: (text, speaker) => shown.push(speaker === undefined ? { text } : { text, speaker }),
      onHide: () => void 0,
    });

    queue.enqueue('A', 1);
    queue.enqueue('B', 1);

    expect(shown).toEqual([{ text: 'A' }]);
    expect(queue.pendingCount).toBe(1);
  });

  it('advances to the next cue after duration expires', () => {
    const shown: { text: string; speaker?: string }[] = [];
    const hidden: boolean[] = [];

    const queue = new SubtitleQueue({
      onShow: (text, speaker) => shown.push(speaker === undefined ? { text } : { text, speaker }),
      onHide: () => hidden.push(true),
    });

    queue.enqueue('A', 1);
    queue.enqueue('B', 1);

    queue.tick(1.0);
    expect(shown).toEqual([{ text: 'A' }, { text: 'B' }]);
    expect(queue.pendingCount).toBe(0);

    queue.tick(1.0);
    expect(hidden).toEqual([true]);
    expect(queue.isShowing).toBe(false);
  });

  it('uses the default duration when none is provided', () => {
    const shown: { text: string }[] = [];
    const queue = new SubtitleQueue({
      onShow: (text) => shown.push({ text }),
      onHide: () => void 0,
    });

    queue.enqueue('No duration');
    expect(shown).toHaveLength(1);
  });

  it('clears all cues and hides', () => {
    const hidden: boolean[] = [];
    const queue = new SubtitleQueue({
      onShow: () => void 0,
      onHide: () => hidden.push(true),
    });

    queue.enqueue('A', 1);
    queue.enqueue('B', 1);
    queue.clear();

    expect(queue.isShowing).toBe(false);
    expect(queue.pendingCount).toBe(0);
    expect(hidden).toEqual([true]);
  });
});
