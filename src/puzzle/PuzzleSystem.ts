/**
 * puzzle/PuzzleSystem.ts — subsystem for all Aperture Science test elements.
 */
import { TransformNode } from '@babylonjs/core';
import type { ChamberDefinition, IGameContext, IPuzzleSystem, PuzzleElementSpec } from '../core/types';
import { LinkSolver } from './solver';
import { ButtonFloor } from './elements/ButtonFloor';
import { ButtonPedestal } from './elements/ButtonPedestal';
import { Cube } from './elements/Cube';
import { CubeDispenser } from './elements/CubeDispenser';
import { Door } from './elements/Door';
import { ExitElevator } from './elements/ExitElevator';
import { FaithPlate } from './elements/FaithPlate';
import { Funnel } from './elements/Funnel';
import { Glass } from './elements/Glass';
import { Goo } from './elements/Goo';
import { LaserEmitter } from './elements/LaserEmitter';
import { LaserReceiver } from './elements/LaserReceiver';
import { LaserRelay } from './elements/LaserRelay';
import { LightBridge } from './elements/LightBridge';
import { Platform } from './elements/Platform';
import { PuzzleMaterials } from './materials';
import type { PuzzleContext } from './types';
import { BasePuzzleElement } from './PuzzleElement';
import type { PuzzleElement } from './types';

export class PuzzleSystem implements IPuzzleSystem {
  readonly name = 'puzzle';

  private ctx!: IGameContext;
  private root: TransformNode | null = null;
  private materials: PuzzleMaterials | null = null;
  private readonly elements = new Map<string, PuzzleElement>();
  private solver = new LinkSolver();
  private readonly eventUnsubs: (() => void)[] = [];

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.eventUnsubs.push(
      ctx.events.on('element:activated', ({ elementId }) => {
        this.solver.setSourceActive(elementId, true);
      }),
    );
    this.eventUnsubs.push(
      ctx.events.on('element:deactivated', ({ elementId }) => {
        this.solver.setSourceActive(elementId, false);
      }),
    );
  }

  buildChamber(definition: ChamberDefinition): void {
    this.clearChamber();

    const scene = this.ctx.scene;
    this.root = new TransformNode('puzzle-root', scene);
    this.materials = new PuzzleMaterials(this.ctx);

    const context: PuzzleContext = {
      ctx: this.ctx,
      parent: this.root,
      laserTargets: new Map(),
      gooVolumes: [],
    };

    // First pass: instantiate every element so cross-references (laser targets,
    // goo volumes, cube fizzle listeners) are available for second pass.
    for (const spec of definition.elements) {
      const element = this.createElement(spec, context, this.materials);
      this.elements.set(spec.id, element);
    }

    // Second pass: wire the link solver.
    this.solver = new LinkSolver();
    this.buildSolver(definition.elements);
    this.solver.onActivationChange((targetId, active) => {
      this.elements.get(targetId)?.setLinkState(active);
    });
    this.solver.reset();
  }

  /**
   * Two passes: register every target BEFORE adding any link. addLink drops
   * the target-side record when the target isn't registered yet, so a source
   * spec appearing before its target in the chamber definition (button before
   * door, receiver before door — i.e. every chamber) silently lost the link.
   */
  private buildSolver(specs: readonly PuzzleElementSpec[]): void {
    for (const spec of specs) {
      this.solver.registerTarget(spec.id, reactorRequirement(spec), defaultActive(spec));
    }
    for (const spec of specs) {
      for (const link of spec.links ?? []) {
        this.solver.addLink(spec.id, link.targetId, link.invert ?? false);
      }
    }
  }

  update(dtSeconds: number): void {
    for (const [id, element] of this.elements) {
      if (element instanceof BasePuzzleElement && element.disposed) {
        this.elements.delete(id);
        continue;
      }
      element.update(dtSeconds);
    }

    if (this.materials) {
      const t = performance.now() / 1000;
      this.materials.scrollTexture(this.materials.bridgeEnergy, 0, t * 0.15);
      this.materials.scrollTexture(this.materials.funnelEnergy, 0, t * 0.12);
      this.materials.scrollTexture(this.materials.gooSurface, t * 0.08, t * 0.04);
    }
  }

  clearChamber(): void {
    for (const element of this.elements.values()) {
      element.dispose();
    }
    this.elements.clear();

    if (this.root) {
      this.root.dispose(false, false);
      this.root = null;
    }
    if (this.materials) {
      this.materials.dispose();
      this.materials = null;
    }
  }

  dispose(): void {
    this.clearChamber();
    for (const unsub of this.eventUnsubs) {
      unsub();
    }
    this.eventUnsubs.length = 0;
  }

  private createElement(spec: PuzzleElementSpec, context: PuzzleContext, materials: PuzzleMaterials): PuzzleElement {
    const { id } = spec;
    switch (spec.type) {
      case 'button-floor':
        return new ButtonFloor(id, spec, context, materials);
      case 'button-pedestal':
        return new ButtonPedestal(id, spec, context, materials);
      case 'cube':
        return new Cube(id, spec, context, materials);
      case 'cube-dispenser':
        return new CubeDispenser(id, spec, context, materials);
      case 'door':
        return new Door(id, spec, context, materials);
      case 'exit-elevator':
        return new ExitElevator(id, spec, context, materials);
      case 'faith-plate':
        return new FaithPlate(id, spec, context, materials);
      case 'funnel':
        return new Funnel(id, spec, context, materials);
      case 'glass':
        return new Glass(id, spec, context, materials);
      case 'goo':
        return new Goo(id, spec, context, materials);
      case 'laser-emitter':
        return new LaserEmitter(id, spec, context, materials);
      case 'laser-receiver':
        return new LaserReceiver(id, spec, context, materials);
      case 'laser-relay':
        return new LaserRelay(id, spec, context, materials);
      case 'light-bridge':
        return new LightBridge(id, spec, context, materials);
      case 'platform':
        return new Platform(id, spec, context, materials);
      default:
        return ((_x: never) => {
          throw new Error('Unknown puzzle element type');
        })(spec);
    }
  }

}

function reactorRequirement(spec: PuzzleElementSpec): 'all' | 'any' {
  return spec.type === 'door' ? (spec.require ?? 'all') : 'all';
}

function defaultActive(spec: PuzzleElementSpec): boolean {
  switch (spec.type) {
    case 'door':
      return spec.startsOpen ?? false;
    case 'funnel':
    case 'light-bridge':
    case 'platform':
      return spec.startsActive ?? true;
    default:
      return false;
  }
}
