/**
 * STUB — replaced by the puzzle-elements subsystem agent.
 */
import type { ChamberDefinition, IGameContext, IPuzzleSystem } from '../core/types';

export class PuzzleSystem implements IPuzzleSystem {
  readonly name = 'puzzle';

  init(_ctx: IGameContext): void {}
  update(_dtSeconds: number): void {}
  buildChamber(_definition: ChamberDefinition): void {}
  clearChamber(): void {}
  dispose(): void {}
}
