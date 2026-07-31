/**
 * levels/LevelSystem.ts — Chamber data, chamber building, level flow, and completion.
 */
import { CONFIG } from '../core/Config';
import type { SaveSystem } from '../core/SaveSystem';
import { SOUND } from '../core/soundIds';
import type { ChamberDefinition, IGameContext, ILevelSystem, LevelListEntry } from '../core/types';
import { ChamberBuilder } from './ChamberBuilder';
import { CAMPAIGN } from './chambers';

const INTRO_LINE_GAP_SECONDS = 3.5;

export class LevelSystem implements ILevelSystem {
  readonly name = 'levels';

  private ctx!: IGameContext;
  private builder: ChamberBuilder | null = null;
  private _currentLevelIndex = 0;
  private currentDefinition: ChamberDefinition | null = null;
  private completed = false;
  private hintShown = false;
  private hintTimer = 0;
  private introTimeouts: number[] = [];
  /** Map from loop id -> sound id for active ambient/chamber loops. */
  private activeLoops = new Map<string, string>();
  private unsubscribeCompletion?: () => void;
  private unsubscribeStateChange?: () => void;
  private elevatorLoopStopTimeout: number | undefined;

  constructor(private readonly save: SaveSystem) {}

  get levelCount(): number {
    return CAMPAIGN.length;
  }

  get currentLevelIndex(): number {
    return this._currentLevelIndex;
  }

  get unlockedLevelIndex(): number {
    return Math.min(this.save.unlockedLevelIndex, this.levelCount - 1);
  }

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.unsubscribeCompletion = ctx.events.on('element:activated', ({ elementId }) => {
      const exit = this.currentDefinition?.elements.find((e) => e.type === 'exit-elevator');
      if (exit && exit.id === elementId) {
        this.completeLevel();
      }
    });
    this.unsubscribeStateChange = ctx.events.on('game:stateChanged', ({ to }) => {
      if (to === 'menu') {
        this.stopAllLoops();
        this.clearElevatorStopTimeout();
      }
    });
  }

  update(dtSeconds: number): void {
    if (this.completed || !this.currentDefinition) return;
    this.hintTimer += dtSeconds;
    if (!this.hintShown && this.hintTimer >= CONFIG.levels.hintDelaySeconds) {
      this.hintShown = true;
      if (this.currentDefinition.hint) {
        this.ctx.events.emit('ui:hint', { text: this.currentDefinition.hint });
      }
    }
  }

  async loadLevel(levelIndex: number): Promise<void> {
    const index = Math.max(0, Math.min(this.levelCount - 1, levelIndex));
    const def = CAMPAIGN[index];

    this._currentLevelIndex = index;
    this.currentDefinition = def;
    this.completed = false;
    this.hintShown = false;
    this.hintTimer = 0;
    this.clearIntroTimeouts();
    this.clearElevatorStopTimeout();
    this.stopAllLoops();

    this.ctx.events.emit('level:loading', { levelIndex: index, definition: def });

    // Portals from the previous chamber must not survive the load: their
    // frames would float mid-air in the new geometry and hijack fire rays
    // (the hop-through-portal path) and crossing checks.
    this.ctx.systems.portals.clearAll();
    this.ctx.systems.puzzle.clearChamber();
    this.builder?.dispose();
    this.builder = new ChamberBuilder(this.ctx);
    this.builder.build(def);
    this.ctx.systems.puzzle.buildChamber(def);

    this.ctx.systems.player.placeAt(def.spawn);
    this.ctx.systems.rendering.setMood(def.mood ?? 'clean');
    this.ctx.systems.audio.setMusicState(index < 3 ? 'chamber-calm' : 'chamber-tense');

    this.scheduleIntroLines(def);
    this.trackLoop(this.ctx.systems.audio.startLoop(SOUND.ambientHum), SOUND.ambientHum);

    this.ctx.events.emit('level:loaded', { levelIndex: index, definition: def });
  }

  async restartLevel(): Promise<void> {
    await this.loadLevel(this._currentLevelIndex);
  }

  getLevelList(): LevelListEntry[] {
    const unlocked = this.unlockedLevelIndex;
    return CAMPAIGN.map((def, index) => ({
      id: def.id,
      name: def.name,
      locked: index > unlocked,
      completed: this.save.isCompleted(def.id),
    }));
  }

  dispose(): void {
    this.unsubscribeCompletion?.();
    this.unsubscribeStateChange?.();
    this.clearIntroTimeouts();
    this.clearElevatorStopTimeout();
    this.stopAllLoops();
    this.builder?.dispose();
  }

  // -----------------------------------------------------------------------------

  private completeLevel(): void {
    if (this.completed || !this.currentDefinition) return;
    this.completed = true;

    const def = this.currentDefinition;
    this.ctx.systems.audio.play(SOUND.chamberComplete);
    this.stopLoopBySoundId(SOUND.ambientHum);
    this.trackLoop(this.ctx.systems.audio.startLoop(SOUND.elevatorLoop), SOUND.elevatorLoop);
    // Final chamber returns to menu without a loadLevel, so schedule the loop stop too.
    this.elevatorLoopStopTimeout = window.setTimeout(() => {
      this.stopLoopBySoundId(SOUND.elevatorLoop);
    }, CONFIG.levels.elevatorRideSeconds * 1000);
    this.ctx.systems.audio.setMusicState('chamber-complete');

    this.ctx.events.emit('level:completed', {
      levelIndex: this._currentLevelIndex,
      levelId: def.id,
      timeMs: 0,
    });
  }

  private scheduleIntroLines(def: ChamberDefinition): void {
    let delay = 0;
    for (const line of def.introLines ?? []) {
      const id = window.setTimeout(() => {
        this.ctx.events.emit('ui:subtitle', { text: line, durationSeconds: 4, speaker: 'announcer' });
      }, delay * 1000);
      this.introTimeouts.push(id);
      delay += INTRO_LINE_GAP_SECONDS;
    }
  }

  private clearIntroTimeouts(): void {
    for (const id of this.introTimeouts) {
      window.clearTimeout(id);
    }
    this.introTimeouts.length = 0;
  }

  private clearElevatorStopTimeout(): void {
    if (this.elevatorLoopStopTimeout !== undefined) {
      window.clearTimeout(this.elevatorLoopStopTimeout);
      this.elevatorLoopStopTimeout = undefined;
    }
  }

  private trackLoop(loopId: string, soundId: string): void {
    this.activeLoops.set(loopId, soundId);
  }

  private stopAllLoops(): void {
    for (const loopId of this.activeLoops.keys()) {
      this.ctx.systems.audio.stopLoop(loopId);
    }
    this.activeLoops.clear();
  }

  private stopLoopBySoundId(soundId: string): void {
    for (const [loopId, id] of this.activeLoops) {
      if (id === soundId) {
        this.ctx.systems.audio.stopLoop(loopId);
        this.activeLoops.delete(loopId);
        return;
      }
    }
  }
}
