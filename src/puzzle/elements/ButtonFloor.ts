/**
 * puzzle/elements/ButtonFloor.ts — 1500-Megawatt pressure plate.
 */
import { MeshBuilder, Vector3, type AbstractMesh } from '@babylonjs/core';
import type { PhysicsBodyHandle } from '../../core/types';
import { CONFIG } from '../../core/Config';
import { damp } from '../../core/math';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { PuzzleContext } from '../types';
import { withToRef } from '../physicsToRef';

const BUTTON_SIZE = 0.8;
const BUTTON_PLATE_RADIUS = 0.36;
/** |bottom - plateTop| tolerance: generous enough for physics jitter, tight
 * enough that a jump arc over the button (bottom ≳ 0.8) doesn't trip it. */
const DETECTION_Y_TOLERANCE = 0.3;

type ButtonFloorSpec = {
  id: string;
  type: 'button-floor';
  position: { x: number; y: number; z: number };
  mode?: 'momentary' | 'latching';
  holdSeconds?: number;
};

export class ButtonFloor extends BasePuzzleElement<ButtonFloorSpec> {
  private readonly state: ButtonState;
  private readonly plate: AbstractMesh;
  private readonly indicator: AbstractMesh;
  private readonly body: PhysicsBodyHandle;
  private wasActive = false;
  private readonly scratchBodyPos = Vector3.Zero();

  constructor(
    id: string,
    spec: ButtonFloorSpec,
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);

    const housing = MeshBuilder.CreateBox(
      `bf-${id}-housing`,
      { width: BUTTON_SIZE, height: 0.12, depth: BUTTON_SIZE },
      this.scene,
    );
    housing.material = this.ctx.systems.rendering.materials.buttonHousing();
    this.track(housing);

    this.plate = MeshBuilder.CreateBox(
      `bf-${id}-plate`,
      { width: BUTTON_SIZE * 0.8, height: 0.06, depth: BUTTON_SIZE * 0.8 },
      this.scene,
    );
    this.plate.position.y = 0.09;
    this.plate.material = this.ctx.systems.rendering.materials.trimMetal();
    this.track(this.plate);

    this.indicator = MeshBuilder.CreateBox(
      `bf-${id}-indicator`,
      { width: BUTTON_SIZE * 0.7, height: 0.02, depth: 0.06 },
      this.scene,
    );
    this.indicator.position.set(0, 0.16, BUTTON_SIZE * 0.42);
    this.indicator.material = materials.orangeEmissive;
    this.track(this.indicator);

    this.body = this.ctx.systems.physics.createStaticBox({
      id: `bf-${id}-collider`,
      size: new Vector3(BUTTON_SIZE, 0.3, BUTTON_SIZE),
      position: this.node.position.clone(),
    });
    this.trackBody(this.body);

    this.state = new ButtonState(spec.mode ?? 'momentary', spec.holdSeconds ?? 0);
  }

  update(dtSeconds: number): void {
    const pressed = this.isPressed();
    this.state.update(pressed, dtSeconds);

    const active = this.state.active;
    if (active && !this.wasActive) {
      this.emitActivated();
    } else if (!active && this.wasActive) {
      this.emitDeactivated();
    }
    this.wasActive = active;

    const targetDepth = active ? -CONFIG.puzzle.buttonPressDepth : 0;
    this.plate.position.y = damp(this.plate.position.y, 0.09 + targetDepth, 18, dtSeconds);

    this.indicator.material = active ? this.materials.cyanEmissive : this.materials.orangeEmissive;
  }

  /** Zero-allocation check for a heavy body or the player standing on the plate. */
  private isPressed(): boolean {
    const centerX = this.node.position.x;
    const centerZ = this.node.position.z;
    // The collider is 0.3 tall centered on the node: its top (the standing
    // surface) sits 0.15 above the node.
    const plateTop = this.node.position.y + 0.15;

    // player.position is the capsule CENTER (~0.9 above the feet) — test the
    // FEET against the plate top or a standing player never registers.
    const player = this.ctx.systems.player.position;
    const playerFeet = player.y - this.ctx.config.player.height / 2;
    if (
      Math.abs(playerFeet - plateTop) <= DETECTION_Y_TOLERANCE &&
      Math.hypot(player.x - centerX, player.z - centerZ) <= BUTTON_PLATE_RADIUS
    ) {
      return true;
    }

    const physics = withToRef(this.ctx.systems.physics);
    const cubeHalf = CONFIG.physics.cubeSize / 2;
    for (const tele of physics.getTeleportables()) {
      physics.getBodyPositionToRef(tele.handle, this.scratchBodyPos);
      // All teleportable objects in this game are Weighted Storage Cubes (cubeMass),
      // so they are heavy enough if cubeMass >= buttonTriggerMass.
      if (CONFIG.physics.cubeMass < CONFIG.puzzle.buttonTriggerMass) continue;
      const cubeBottom = this.scratchBodyPos.y - cubeHalf;
      if (
        Math.abs(cubeBottom - plateTop) <= DETECTION_Y_TOLERANCE &&
        Math.hypot(this.scratchBodyPos.x - centerX, this.scratchBodyPos.z - centerZ) <= BUTTON_PLATE_RADIUS
      ) {
        return true;
      }
    }
    return false;
  }
}

/** Pure state machine for momentary/latching floor buttons. */
export class ButtonState {
  active = false;
  private holdTimer = 0;
  private latched = false;
  private previousPressed = false;

  constructor(
    private readonly mode: 'momentary' | 'latching',
    private readonly holdSeconds: number,
  ) {}

  update(pressed: boolean, dt: number): void {
    if (this.mode === 'latching') {
      if (pressed && !this.previousPressed) {
        this.latched = !this.latched;
      }
      this.active = this.latched;
    } else {
      if (pressed) {
        this.active = true;
        this.holdTimer = this.holdSeconds;
      } else if (this.active) {
        this.holdTimer -= dt;
        if (this.holdTimer <= 0) {
          this.active = false;
          this.holdTimer = 0;
        }
      }
    }

    this.previousPressed = pressed;
  }
}
