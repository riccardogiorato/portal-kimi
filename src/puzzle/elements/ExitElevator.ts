/**
 * puzzle/elements/ExitElevator.ts — completion elevator.
 */
import { Color3, MeshBuilder, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import type { PhysicsBodyHandle, PuzzleElementSpec } from '../../core/types';
import { SOUND } from '../../core/soundIds';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { PuzzleContext } from '../types';

const ELEVATOR_SIZE = { width: 1.6, depth: 1.6, height: 2.6 };
const TRIGGER_HALF = { x: 0.55, y: 1.0, z: 0.55 };
const CLOSE_SECONDS = 0.6;

type ExitElevatorSpec = Extract<PuzzleElementSpec, { type: 'exit-elevator' }>;

export class ExitElevator extends BasePuzzleElement<ExitElevatorSpec> {
  private readonly leftDoor: AbstractMesh;
  private readonly rightDoor: AbstractMesh;
  private readonly light: AbstractMesh;
  private readonly trigger: AbstractMesh;
  private readonly body: PhysicsBodyHandle;
  private triggered = false;
  private closed = false;
  private closeTimer = 0;
  private loopId: string | null = null;

  constructor(
    id: string,
    spec: ExitElevatorSpec,
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);

    const halfW = ELEVATOR_SIZE.width / 2;
    const halfD = ELEVATOR_SIZE.depth / 2;

    const shell = MeshBuilder.CreateBox(
      `elev-${id}-shell`,
      { width: ELEVATOR_SIZE.width + 0.1, height: ELEVATOR_SIZE.height, depth: ELEVATOR_SIZE.depth + 0.1 },
      this.scene,
    );
    shell.position.y = ELEVATOR_SIZE.height / 2;
    shell.material = this.ctx.systems.rendering.materials.wallPanel(false);
    this.track(shell);

    this.leftDoor = MeshBuilder.CreateBox(
      `elev-${id}-left`,
      { width: halfW - 0.02, height: ELEVATOR_SIZE.height - 0.1, depth: 0.1 },
      this.scene,
    );
    this.leftDoor.position.set(-(halfW / 2 - 0.01), ELEVATOR_SIZE.height / 2, halfD);
    this.leftDoor.material = this.ctx.systems.rendering.materials.trimMetal();
    this.track(this.leftDoor);

    this.rightDoor = MeshBuilder.CreateBox(
      `elev-${id}-right`,
      { width: halfW - 0.02, height: ELEVATOR_SIZE.height - 0.1, depth: 0.1 },
      this.scene,
    );
    this.rightDoor.position.set(halfW / 2 - 0.01, ELEVATOR_SIZE.height / 2, halfD);
    this.rightDoor.material = this.ctx.systems.rendering.materials.trimMetal();
    this.track(this.rightDoor);

    this.light = MeshBuilder.CreateBox(
      `elev-${id}-light`,
      { width: ELEVATOR_SIZE.width - 0.3, height: 0.06, depth: 0.08 },
      this.scene,
    );
    this.light.position.set(0, ELEVATOR_SIZE.height - 0.2, halfD + 0.05);
    this.light.material = materials.cyanEmissive;
    this.track(this.light);

    this.trigger = MeshBuilder.CreateBox(
      `elev-${id}-trigger`,
      { width: TRIGGER_HALF.x * 2, height: TRIGGER_HALF.y * 2, depth: TRIGGER_HALF.z * 2 },
      this.scene,
    );
    this.trigger.position.y = TRIGGER_HALF.y;
    this.trigger.isVisible = false;
    this.track(this.trigger);

    this.body = this.ctx.systems.physics.createStaticBox({
      id: `elevator-body-${id}`,
      size: new Vector3(ELEVATOR_SIZE.width, ELEVATOR_SIZE.height, ELEVATOR_SIZE.depth),
      position: this.node.position.clone().add(new Vector3(0, ELEVATOR_SIZE.height / 2, 0)),
    });
    this.trackBody(this.body);

    this.loopId = this.ctx.systems.audio.startLoop(SOUND.elevatorLoop, this.node.position);
  }

  update(dtSeconds: number): void {
    if (this.closed) return;

    if (!this.triggered) {
      const px = this.ctx.systems.player.position.x - this.node.position.x;
      const py = this.ctx.systems.player.position.y - (this.node.position.y + TRIGGER_HALF.y);
      const pz = this.ctx.systems.player.position.z - this.node.position.z;

      if (
        Math.abs(px) <= TRIGGER_HALF.x &&
        Math.abs(py) <= TRIGGER_HALF.y &&
        Math.abs(pz) <= TRIGGER_HALF.z
      ) {
        this.triggered = true;
        (this.light.material as import('@babylonjs/core').StandardMaterial).emissiveColor = new Color3(1, 0.9, 0.2);
      }
    }

    if (this.triggered) {
      this.closeTimer += dtSeconds;
      const halfW = ELEVATOR_SIZE.width / 2;
      this.leftDoor.position.x = -halfW / 2 + 0.01;
      this.rightDoor.position.x = halfW / 2 - 0.01;

      if (this.closeTimer >= CLOSE_SECONDS) {
        this.closed = true;
        this.ctx.systems.audio.play(SOUND.chamberComplete);
        this.emitActivated();
      }
    }
  }

  protected beforeDispose(): void {
    if (this.loopId) {
      this.ctx.systems.audio.stopLoop(this.loopId);
      this.loopId = null;
    }
  }
}
