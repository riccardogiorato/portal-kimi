/**
 * puzzle/elements/LightBridge.ts — hard-light walkway.
 */
import { MeshBuilder, Quaternion, TransformNode, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import type { PhysicsBodyHandle, PuzzleElementSpec, StaticBoxOptions } from '../../core/types';
import { CONFIG } from '../../core/Config';
import { SOUND } from '../../core/soundIds';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { PuzzleContext } from '../types';

const BRIDGE_WIDTH = 1.2;

type LightBridgeSpec = Extract<PuzzleElementSpec, { type: 'light-bridge' }>;

export class LightBridge extends BasePuzzleElement<LightBridgeSpec> {
  private readonly direction: Vector3;
  private active: boolean;
  private readonly panel: AbstractMesh;
  private readonly midLocal: Vector3;
  private readonly emitter: AbstractMesh;
  private body: PhysicsBodyHandle | null = null;
  private loopId: string | null = null;

  constructor(
    id: string,
    spec: LightBridgeSpec,
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);

    this.direction = new Vector3(spec.direction.x, spec.direction.y, spec.direction.z).normalizeToNew();
    this.active = spec.startsActive ?? true;

    this.emitter = MeshBuilder.CreateBox(
      `bridge-${id}-emitter`,
      { width: 0.35, height: 0.35, depth: 0.35 },
      this.scene,
    );
    this.emitter.material = this.ctx.systems.rendering.materials.trimMetal();
    this.track(this.emitter);

    // Local offset from the node to the bridge center — the panel is parented
    // to the node, so its position must be LOCAL (a world-space mid doubled
    // the node's offset and floated the visual away from its physics body).
    this.midLocal = this.direction.scale(spec.length / 2);
    const orient = new TransformNode(`bridge-${id}-tmp`, this.scene);
    orient.position.copyFrom(this.node.position);
    orient.lookAt(this.node.position.add(this.direction));
    const rotation = orient.rotationQuaternion ? orient.rotationQuaternion.clone() : Quaternion.Identity();
    orient.dispose();

    this.panel = MeshBuilder.CreateBox(
      `bridge-${id}-panel`,
      // Length runs along local Z: lookAt aims local +Z down the bridge
      // direction. (A Y-length box stays vertical after lookAt — the bridge
      // used to stand upright like a wall.)
      { width: BRIDGE_WIDTH, height: CONFIG.puzzle.lightBridgeThickness, depth: spec.length },
      this.scene,
    );
    this.panel.position.copyFrom(this.midLocal);
    this.panel.rotationQuaternion = rotation;
    this.panel.material = materials.bridgeEnergy;
    this.panel.metadata = { ...this.panel.metadata, portalable: false };
    this.track(this.panel);

    if (this.active) {
      this.enableBody();
      this.loopId = this.ctx.systems.audio.startLoop(SOUND.bridgeLoop, this.node.position);
    }
  }

  onLinkState(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) {
      this.enableBody();
      this.loopId = this.ctx.systems.audio.startLoop(SOUND.bridgeLoop, this.node.position);
    } else {
      this.disableBody();
      if (this.loopId) {
        this.ctx.systems.audio.stopLoop(this.loopId);
        this.loopId = null;
      }
    }
  }

  update(_dtSeconds: number): void {
    this.panel.isVisible = this.active;
  }

  private enableBody(): void {
    if (this.body) return;
    const options: StaticBoxOptions = {
      id: `bridge-body-${this.id}`,
      size: new Vector3(BRIDGE_WIDTH, CONFIG.puzzle.lightBridgeThickness, this.spec.length),
      // World position = node + local mid (panel.position is node-relative).
      position: this.node.position.add(this.midLocal),
    };
    if (this.panel.rotationQuaternion) {
      options.rotation = this.panel.rotationQuaternion.clone();
    }
    this.body = this.ctx.systems.physics.createStaticBox(options);
    this.trackBody(this.body);
  }

  private disableBody(): void {
    if (!this.body) return;
    this.ctx.systems.physics.removeBody(this.body);
    this.body = null;
  }

  protected beforeDispose(): void {
    this.disableBody();
    if (this.loopId) {
      this.ctx.systems.audio.stopLoop(this.loopId);
      this.loopId = null;
    }
  }
}
