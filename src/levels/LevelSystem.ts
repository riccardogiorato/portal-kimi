/**
 * STUB — replaced by the levels subsystem agent.
 * Builds a bare floor so integration can run before real chambers land.
 */
import { MeshBuilder, StandardMaterial, Color3 } from '@babylonjs/core';
import type { SaveSystem } from '../core/SaveSystem';
import type { ChamberDefinition, IGameContext, ILevelSystem, LevelListEntry } from '../core/types';

const STUB_CHAMBER: ChamberDefinition = {
  id: 'stub-chamber',
  name: 'Test Chamber 00',
  size: { width: 20, height: 6, depth: 20 },
  spawn: { position: { x: 0, y: 1.8, z: -6 }, yawDegrees: 0 },
  elements: [],
};

export class LevelSystem implements ILevelSystem {
  readonly name = 'levels';
  private ctx!: IGameContext;
  private levelIndex = 0;

  constructor(private readonly save: SaveSystem) {
    void this.save;
  }

  get currentLevelIndex(): number {
    return this.levelIndex;
  }
  get levelCount(): number {
    return 1;
  }
  get unlockedLevelIndex(): number {
    return 0;
  }
  getLevelList(): LevelListEntry[] {
    return [{ id: STUB_CHAMBER.id, name: STUB_CHAMBER.name, locked: false, completed: false }];
  }

  init(ctx: IGameContext): void {
    this.ctx = ctx;
  }

  update(_dtSeconds: number): void {}

  async loadLevel(levelIndex: number): Promise<void> {
    this.levelIndex = levelIndex;
    this.ctx.events.emit('level:loading', { levelIndex, definition: STUB_CHAMBER });
    const scene = this.ctx.scene;
    const ground = MeshBuilder.CreateGround('stubGround', { width: 20, height: 20 }, scene);
    const material = new StandardMaterial('stubGroundMat', scene);
    material.diffuseColor = new Color3(0.5, 0.5, 0.55);
    ground.material = material;
    this.ctx.systems.player.placeAt(STUB_CHAMBER.spawn);
    this.ctx.events.emit('level:loaded', { levelIndex, definition: STUB_CHAMBER });
  }

  async restartLevel(): Promise<void> {
    await this.loadLevel(this.levelIndex);
  }

  dispose(): void {}
}
