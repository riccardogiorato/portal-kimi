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
const DETECTION_Y_TOLERANCE = 0.45;

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
    const centerY = this.node.position.y;
    const centerZ = this.node.position.z;

    if (
      isWithinButtonDisc(
        this.ctx.systems.player.position.x,
        this.ctx.systems.player.position.y,
        this.ctx.systems.player.position.z,
        centerX,
        centerY,
        centerZ,
      )
    ) {
      return true;
    }

    const physics = withToRef(this.ctx.systems.physics);
    for (const tele of physics.getTeleportables()) {
      physics.getBodyPositionToRef(tele.handle, this.scratchBodyPos);
      // All teleportable objects in this game are Weighted Storage Cubes (cubeMass),
      // so they are heavy enough if cubeMass >= buttonTriggerMass.
      if (
        CONFIG.physics.cubeMass >= CONFIG.puzzle.buttonTriggerMass &&
        isWithinButtonDisc(this.scratchBodyPos.x, this.scratchBodyPos.y, this.scratchBodyPos.z, centerX, centerY, centerZ)
      ) {
        return true;
      }
    }
    return false;
  }
}

function isWithinButtonDisc(
  px: number,
  py: number,
  pz: number,
  cx: number,
  cy: number,
  cz: number,
): boolean {
  return (
    Math.abs(py - cy) <= DETECTION_Y_TOLERANCE + 1e-6 &&
    Math.hypot(px - cx, pz - cz) <= BUTTON_PLATE_RADIUS + 1e-6
  );
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
