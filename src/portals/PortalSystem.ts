/**
 * STUB — replaced by the portal subsystem agent.
 */
import type { AbstractMesh } from '@babylonjs/core';
import type { IGameContext, IPortalHandle, IPortalSystem, PortalColor } from '../core/types';

export class PortalSystem implements IPortalSystem {
  readonly name = 'portals';

  init(_ctx: IGameContext): void {}
  update(_dtSeconds: number): void {}
  fire(_color: PortalColor): void {}
  getPortal(_color: PortalColor): IPortalHandle | null {
    return null;
  }
  get isLinked(): boolean {
    return false;
  }
  clearAll(): void {}
  isPortalable(_mesh: AbstractMesh): boolean {
    return false;
  }
  dispose(): void {}
}
