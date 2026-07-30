/**
 * puzzle/elements/ExitElevator.ts — completion elevator.
 *
 * A hollow, enterable cab: the player must step INSIDE for completion to
 * trigger. The cab orients itself against the nearest wall — local +Z is the
 * doorway and faces the room along the dominant inward axis. Physics is
 * per-panel (back, sides, top, front flanks, header) so the doorway stays
 * walkable; the old single solid body filled the trigger volume and made
 * chamber completion impossible.
 */
import { Color3, Matrix, MeshBuilder, Quaternion, StandardMaterial, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import type { PhysicsBodyHandle, PuzzleElementSpec } from '../../core/types';
import { SOUND } from '../../core/soundIds';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { PuzzleContext } from '../types';

const CAB = { width: 2.6, depth: 1.6, height: 2.6 };
const DOOR = { width: 1.2, height: 2.2 };
const WALL_T = 0.1;
const TRIGGER_HALF = { x: 0.6, y: 1.0, z: 0.6 };
const CLOSE_SECONDS = 0.6;
/** Door slab local |x| when open (tucked behind the front flanks) / closed. */
const DOOR_OPEN_X = 0.87;
const DOOR_CLOSED_X = 0.29;

type ExitElevatorSpec = Extract<PuzzleElementSpec, { type: 'exit-elevator' }>;

export class ExitElevator extends BasePuzzleElement<ExitElevatorSpec> {
  private readonly leftDoor: AbstractMesh;
  private readonly rightDoor: AbstractMesh;
  private readonly lightMaterial: StandardMaterial;
  private readonly trigger: AbstractMesh;
  private readonly bodies: PhysicsBodyHandle[] = [];
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

    const W = CAB.width;
    const D = CAB.depth;
    const H = CAB.height;
    const T = WALL_T;
    const halfW = W / 2;
    const halfD = D / 2;
    const doorHalf = DOOR.width / 2;
    const flankW = (W - DOOR.width) / 2;

    // Doorway (local +Z) faces the room: inward normal of the nearest wall,
    // snapped to the dominant axis so the cab sits flush against it.
    const p = spec.position;
    const facing =
      Math.abs(p.z) >= Math.abs(p.x)
        ? new Vector3(0, 0, p.z >= 0 ? -1 : 1)
        : new Vector3(p.x >= 0 ? -1 : 1, 0, 0);
    const yaw = Math.atan2(facing.x, facing.z);
    const rotation = Quaternion.RotationYawPitchRoll(yaw, 0, 0);
    this.node.rotationQuaternion = rotation.clone();

    const shellMaterial = this.ctx.systems.rendering.materials.wallPanel(true);
    const trimMaterial = this.ctx.systems.rendering.materials.trimMetal();

    // --- shell panels (visual + one static body each) ---
    const panels: Array<{ name: string; size: Vector3; center: Vector3 }> = [
      { name: 'back', size: new Vector3(W, H, T), center: new Vector3(0, H / 2, -halfD + T / 2) },
      { name: 'left', size: new Vector3(T, H, D), center: new Vector3(-halfW + T / 2, H / 2, 0) },
      { name: 'right', size: new Vector3(T, H, D), center: new Vector3(halfW - T / 2, H / 2, 0) },
      { name: 'top', size: new Vector3(W, T, D), center: new Vector3(0, H - T / 2, 0) },
      {
        name: 'front-left',
        size: new Vector3(flankW, H, T),
        center: new Vector3(-(doorHalf + flankW / 2), H / 2, halfD - T / 2),
      },
      {
        name: 'front-right',
        size: new Vector3(flankW, H, T),
        center: new Vector3(doorHalf + flankW / 2, H / 2, halfD - T / 2),
      },
      {
        name: 'header',
        size: new Vector3(DOOR.width, H - DOOR.height, T),
        center: new Vector3(0, DOOR.height + (H - DOOR.height) / 2, halfD - T / 2),
      },
    ];

    const rotMatrix = Matrix.RotationY(yaw);
    const worldCenter = Vector3.Zero();
    for (const panel of panels) {
      const mesh = MeshBuilder.CreateBox(`elev-${id}-${panel.name}`, { width: panel.size.x, height: panel.size.y, depth: panel.size.z }, this.scene);
      mesh.position.copyFrom(panel.center);
      mesh.material = shellMaterial;
      this.track(mesh);

      // Physics bodies live in world space: rotate the local center into place.
      Vector3.TransformCoordinatesToRef(panel.center, rotMatrix, worldCenter);
      worldCenter.addInPlace(this.node.position);
      const body = this.ctx.systems.physics.createStaticBox({
        id: `elevator-body-${id}-${panel.name}`,
        size: panel.size,
        position: worldCenter,
        rotation,
      });
      this.bodies.push(body);
      this.trackBody(body);
    }

    // --- pocket doors (start open, slide shut once the player is inside) ---
    const doorSlabW = doorHalf - 0.02;
    this.leftDoor = MeshBuilder.CreateBox(
      `elev-${id}-left`,
      { width: doorSlabW, height: DOOR.height, depth: 0.08 },
      this.scene,
    );
    this.leftDoor.position.set(-DOOR_OPEN_X, DOOR.height / 2, halfD - 0.12);
    this.leftDoor.material = trimMaterial;
    this.track(this.leftDoor);

    this.rightDoor = MeshBuilder.CreateBox(
      `elev-${id}-right`,
      { width: doorSlabW, height: DOOR.height, depth: 0.08 },
      this.scene,
    );
    this.rightDoor.position.set(DOOR_OPEN_X, DOOR.height / 2, halfD - 0.12);
    this.rightDoor.material = trimMaterial;
    this.track(this.rightDoor);

    // --- lights: call-sign strip above the doorway + interior ceiling glow ---
    // Own material for the strip: it changes color on trigger and must not
    // mutate the shared puzzle emissive.
    this.lightMaterial = new StandardMaterial(`elev-${id}-lightmat`, this.scene);
    this.lightMaterial.emissiveColor = new Color3(0.12, 0.72, 1);
    this.lightMaterial.disableLighting = true;
    const strip = MeshBuilder.CreateBox(
      `elev-${id}-light`,
      { width: DOOR.width + 0.2, height: 0.08, depth: 0.06 },
      this.scene,
    );
    strip.position.set(0, DOOR.height + 0.14, halfD + 0.04);
    strip.material = this.lightMaterial;
    this.track(strip);

    const ceilingGlow = MeshBuilder.CreateBox(
      `elev-${id}-glow`,
      { width: 1.2, height: 0.05, depth: 0.6 },
      this.scene,
    );
    ceilingGlow.position.set(0, H - 0.14, 0);
    ceilingGlow.material = materials.cyanEmissive;
    this.track(ceilingGlow);

    // --- completion trigger: inside the cab, reachable now that it's hollow ---
    this.trigger = MeshBuilder.CreateBox(
      `elev-${id}-trigger`,
      { width: TRIGGER_HALF.x * 2, height: TRIGGER_HALF.y * 2, depth: TRIGGER_HALF.z * 2 },
      this.scene,
    );
    this.trigger.position.y = TRIGGER_HALF.y;
    this.trigger.isVisible = false;
    this.track(this.trigger);

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
        this.lightMaterial.emissiveColor = new Color3(1, 0.9, 0.2);
      }
    }

    if (this.triggered) {
      this.closeTimer += dtSeconds;
      const t = Math.min(1, this.closeTimer / CLOSE_SECONDS);
      const x = DOOR_OPEN_X - (DOOR_OPEN_X - DOOR_CLOSED_X) * t;
      this.leftDoor.position.x = -x;
      this.rightDoor.position.x = x;

      if (t >= 1) {
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
    this.lightMaterial.dispose();
  }
}
