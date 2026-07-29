/**
 * core/SaveSystem.ts — Campaign progress persistence (localStorage).
 */
import type { SaveData } from './types';

const STORAGE_KEY = 'portal-kimi:save:v1';

const EMPTY_SAVE: SaveData = {
  version: 1,
  unlockedLevelIndex: 0,
  completedLevelIds: [],
  bestTimeMsByLevel: {},
};

export class SaveSystem {
  private data: SaveData;

  constructor() {
    this.data = this.load();
  }

  get snapshot(): Readonly<SaveData> {
    return this.data;
  }

  get unlockedLevelIndex(): number {
    return this.data.unlockedLevelIndex;
  }

  isCompleted(levelId: string): boolean {
    return this.data.completedLevelIds.includes(levelId);
  }

  recordCompletion(levelId: string, levelIndex: number, timeMs: number): void {
    if (!this.data.completedLevelIds.includes(levelId)) {
      this.data.completedLevelIds.push(levelId);
    }
    this.data.unlockedLevelIndex = Math.max(this.data.unlockedLevelIndex, levelIndex + 1);
    const best = this.data.bestTimeMsByLevel[levelId];
    if (best === undefined || timeMs < best) {
      this.data.bestTimeMsByLevel[levelId] = timeMs;
    }
    this.persist();
  }

  resetProgress(): void {
    this.data = { ...EMPTY_SAVE, completedLevelIds: [], bestTimeMsByLevel: {} };
    this.persist();
  }

  private load(): SaveData {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return structuredClone(EMPTY_SAVE);
      const parsed = JSON.parse(raw) as SaveData;
      if (parsed.version !== 1) return structuredClone(EMPTY_SAVE);
      return parsed;
    } catch {
      return structuredClone(EMPTY_SAVE);
    }
  }

  private persist(): void {
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Non-fatal: progress just won't persist.
    }
  }
}
