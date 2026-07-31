/**
 * levels/ChamberBuilder.ts — Procedural chamber shell for PORTAL-KIMI.
 *
 * Builds merged panel tiles, invisible per-run physics proxies carrying
 * portalability metadata, dressing (lights, trim, signage, observation glass),
 * and framing for the entry airlock and exit elevator.
 */
import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  Quaternion,
  StandardMaterial,
  TransformNode,
  Vector3,
  Matrix,
  type AbstractMesh,
  type Material,
  type Scene,
} from '@babylonjs/core';
import type { ChamberDefinition, IGameContext, Vec3, WallId } from '../core/types';
import {
  applySurfaceOverride,
  buildWallGrid,
  carveGooHoles,
  partitionWall,
  runCenter,
  wallInfo,
  type PanelRun,
  type WallInfo,
} from './math';

const WALLS: WallId[] = ['north', 'south', 'east', 'west', 'floor', 'ceiling'];
const TRIM_HEIGHT = 0.15;
const TRIM_DEPTH = 0.08;
const DEFAULT_DOOR_WIDTH = 2.2;
const DEFAULT_DOOR_HEIGHT = 2.5;
const DOOR_POST_WIDTH = 0.14;

/** Opaque handle returned by `buildChamber`; call `dispose()` to tear it down. */
export class ChamberBuilder {
  private readonly root: TransformNode;
  private readonly proxyHandles: string[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  private readonly scene: Scene;
  private readonly ctx: IGameContext;
  private readonly panelSize: number;
  private readonly panelThickness: number;

  constructor(ctx: IGameContext) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.panelSize = ctx.config.levels.panelSize;
    this.panelThickness = ctx.config.levels.panelThickness;
    this.root = new TransformNode('chamberRoot', this.scene);
    this.root.position = Vector3.Zero();
  }

  build(definition: ChamberDefinition): void {
    const { size, elements } = definition;

    for (const wall of WALLS) {
      const info = wallInfo(wall, size, this.panelSize);
      const grid = this.buildWallGrid(info, definition);
      const runs = partitionWall(grid, wall);
      for (const run of runs) {
        this.buildRunMesh(info, run, definition.mood ?? 'clean');
        this.buildProxyBody(info, run);
      }
    }

    // Skirting around every vertical wall, plus entry/exit frames.
    for (const wall of WALLS) {
      if (wall !== 'floor' && wall !== 'ceiling') {
        this.buildBaseboard(wallInfo(wall, size, this.panelSize));
      }
    }

    const entryWall = nearestWall(definition.spawn.position, size, this.panelSize);
    this.buildAirlockFrame(entryWall, definition.spawn.position);

    // Door elements gate the exit: wall off the doorway plane so the door is
    // the only way through (otherwise the "puzzle" is walk-around-able).
    for (const element of elements) {
      if (element.type === 'door') {
        this.buildDivider(element, definition);
      }
    }

    const elevator = elements.find((e) => e.type === 'exit-elevator');
    if (elevator) {
      const exitWall = nearestWall(elevator.position, size, this.panelSize);
      this.buildDoorFrame(exitWall, elevator.position, `exit-${elevator.id}`);
      this.buildSign(definition, exitWall, elevator.position);
    }

    const glassWall = wallInfo('east', size, this.panelSize);
    this.buildObservationGlass(glassWall);
    this.buildCeilingLights(size);
  }

  dispose(): void {
    for (const handle of this.proxyHandles) {
      const mesh = this.ctx.systems.physics.getMeshForBody(handle);
      this.ctx.systems.physics.removeBody(handle);
      mesh?.dispose();
    }
    this.proxyHandles.length = 0;

    for (const item of this.disposables) {
      item.dispose();
    }
    this.disposables.length = 0;

    this.root.dispose(false, false);
  }

  // ---------------------------------------------------------------------------
  // Walls
  // ---------------------------------------------------------------------------

  private buildWallGrid(info: WallInfo, definition: ChamberDefinition) {
    let grid = buildWallGrid(info, true);
    for (const override of definition.surfaceOverrides ?? []) {
      if (override.wall === info.wall) {
        grid = applySurfaceOverride(grid, override);
      }
    }
    // Goo elements create open pits in the floor.
    grid = carveGooHoles(grid, info, definition, this.panelSize);
    return grid;
  }

  private buildRunMesh(info: WallInfo, run: PanelRun, mood: ChamberDefinition['mood']): void {
    const center = runCenter(info, run, this.panelSize);
    const widthM = run.cols * this.panelSize;
    const heightM = run.rows * this.panelSize;

    const mesh = MeshBuilder.CreateBox(
      `panel-${info.wall}-${run.startCol}-${run.startRow}`,
      { width: widthM, height: heightM, depth: this.panelThickness },
      this.scene,
    );
    mesh.material = this.pickPanelMaterial(info.wall, run.portalable);
    mesh.parent = this.root;
    mesh.position.set(center.x, center.y, center.z);
    mesh.rotationQuaternion = this.wallRotation(info, mood === 'damaged' && info.wall !== 'floor' && info.wall !== 'ceiling' ? run : null);
    // Panel boxes must render their room-facing side: with the wrong side
    // orientation the room face is culled and the wall shows its unlit inner
    // back face (the "black curtain" bug). The effective winding flips with
    // each wall's placement rotation, so the correct value is per-wall —
    // verified empirically across all six chambers (south is the odd one out).
    mesh.sideOrientation = info.wall === 'south' ? 1 : 0;
    mesh.checkCollisions = false;
    mesh.metadata = { portalable: run.portalable, panelSize: { width: widthM, height: heightM } };
    mesh.freezeWorldMatrix();

    if (mood === 'damaged' && info.wall !== 'floor' && info.wall !== 'ceiling') {
      this.damagedPanelOffset(mesh, info, run);
    }
  }

  private buildProxyBody(info: WallInfo, run: PanelRun): void {
    const center = runCenter(info, run, this.panelSize);
    const widthM = run.cols * this.panelSize;
    const heightM = run.rows * this.panelSize;

    const handle = this.ctx.systems.physics.createStaticBox({
      id: `proxy-${info.wall}-${run.startCol}-${run.startRow}`,
      size: new Vector3(widthM, heightM, this.panelThickness),
      position: new Vector3(center.x, center.y, center.z),
      rotation: this.wallRotation(info),
    });

    this.proxyHandles.push(handle);
    const mesh = this.ctx.systems.physics.getMeshForBody(handle);
    if (mesh) {
      mesh.isVisible = false;
      mesh.metadata = {
        portalable: run.portalable,
        panelSize: { width: widthM, height: heightM },
      };
    }
  }

  private pickPanelMaterial(wall: WallId, portalable: boolean): Material {
    const mats = this.ctx.systems.rendering.materials;
    if (wall === 'floor') return mats.floorPanel();
    if (wall === 'ceiling') return mats.ceilingPanel();
    return mats.wallPanel(portalable);
  }

  // ---------------------------------------------------------------------------
  // Orientation
  // ---------------------------------------------------------------------------

  private wallRotation(info: WallInfo, run: PanelRun | null = null): Quaternion {
    const normal = vec3ToBabylon(info.normal);
    const v = vec3ToBabylon(info.v);
    const u = Vector3.Cross(v, normal).normalize();
    const m = Matrix.FromValues(
      u.x, v.x, normal.x, 0,
      u.y, v.y, normal.y, 0,
      u.z, v.z, normal.z, 0,
      0, 0, 0, 1,
    );
    const q = Quaternion.FromRotationMatrix(m);

    if (run) {
      const seed = run.startCol * 7321 + run.startRow * 9277;
      const yaw = (deterministic(seed) - 0.5) * 0.08;
      const tilt = (deterministic(seed + 1) - 0.5) * 0.03;
      q.multiplyInPlace(Quaternion.RotationAxis(normal, yaw));
      q.multiplyInPlace(Quaternion.RotationAxis(u, tilt));
    }
    return q;
  }

  private damagedPanelOffset(mesh: AbstractMesh, info: WallInfo, run: PanelRun): void {
    const normal = vec3ToBabylon(info.normal);
    const seed = run.startCol * 7321 + run.startRow * 9277;
    const offset = normal.scale(((deterministic(seed + 2) - 0.5) * 0.04));
    mesh.position.addInPlace(offset);
    mesh.unfreezeWorldMatrix();
    mesh.freezeWorldMatrix();
  }

  // ---------------------------------------------------------------------------
  // Door divider wall
  // ---------------------------------------------------------------------------

  /**
   * Full-span interior wall at the door's plane with a doorway gap. Both
   * faces are room-facing, so panels render double-sided (the shell's
   * single-sided per-wall winding would black-curtain the back).
   */
  private buildDivider(
    door: Extract<ChamberDefinition['elements'][number], { type: 'door' }>,
    definition: ChamberDefinition,
  ): void {
    const { size } = definition;
    const doorSize = this.ctx.config.puzzle.doorSize;
    const gapHalf = doorSize.width / 2 + 0.08; // doorway + the door's frame posts
    const H = size.height;
    const T = this.panelThickness;
    const dp = door.position;

    // Runs are axis-aligned boxes: [center, width] along the wall's long axis.
    const runs: Array<{ center: number; width: number; y: number; height: number }> = [];
    if (door.orientation === 'x') {
      const half = size.width / 2;
      const leftW = dp.x - gapHalf - -half;
      const rightW = half - (dp.x + gapHalf);
      if (leftW > 0.01) runs.push({ center: -half + leftW / 2, width: leftW, y: H / 2, height: H });
      if (rightW > 0.01) runs.push({ center: dp.x + gapHalf + rightW / 2, width: rightW, y: H / 2, height: H });
      const lintelH = H - doorSize.height;
      if (lintelH > 0.01) {
        runs.push({ center: dp.x, width: doorSize.width + 0.16, y: doorSize.height + lintelH / 2, height: lintelH });
      }
    } else {
      const half = size.depth / 2;
      const nearW = dp.z - gapHalf - -half;
      const farW = half - (dp.z + gapHalf);
      if (nearW > 0.01) runs.push({ center: -half + nearW / 2, width: nearW, y: H / 2, height: H });
      if (farW > 0.01) runs.push({ center: dp.z + gapHalf + farW / 2, width: farW, y: H / 2, height: H });
      const lintelH = H - doorSize.height;
      if (lintelH > 0.01) {
        runs.push({ center: dp.z, width: doorSize.width + 0.16, y: doorSize.height + lintelH / 2, height: lintelH });
      }
    }

    const material = this.ctx.systems.rendering.materials.wallPanel(true);
    for (const run of runs) {
      const alongX = door.orientation === 'x';
      const mesh = MeshBuilder.CreateBox(
        `divider-${door.id}-${run.center.toFixed(2)}-${run.y.toFixed(2)}`,
        alongX
          ? { width: run.width, height: run.height, depth: T }
          : { width: T, height: run.height, depth: run.width },
        this.scene,
      );
      mesh.material = material;
      mesh.parent = this.root;
      mesh.position.set(
        alongX ? run.center : dp.x,
        run.y,
        alongX ? dp.z : run.center,
      );
      mesh.sideOrientation = Mesh.DOUBLESIDE;
      mesh.checkCollisions = false;
      mesh.metadata = { portalable: true, panelSize: { width: run.width, height: run.height } };
      mesh.freezeWorldMatrix();

      const handle = this.ctx.systems.physics.createStaticBox({
        id: `divider-body-${door.id}-${run.center.toFixed(2)}-${run.y.toFixed(2)}`,
        size: new Vector3(
          alongX ? run.width : T,
          run.height,
          alongX ? T : run.width,
        ),
        position: new Vector3(alongX ? run.center : dp.x, run.y, alongX ? dp.z : run.center),
      });
      this.proxyHandles.push(handle);
      const proxy = this.ctx.systems.physics.getMeshForBody(handle);
      if (proxy) {
        proxy.isVisible = false;
        proxy.metadata = { portalable: true, panelSize: { width: run.width, height: run.height } };
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Trim, frames and signage
  // ---------------------------------------------------------------------------

  private buildBaseboard(info: WallInfo): void {
    if (info.wall === 'floor' || info.wall === 'ceiling') return;
    const lengthM = info.cols * this.panelSize;
    const center = wallPoint(info, lengthM / 2, TRIM_HEIGHT / 2);
    const mesh = MeshBuilder.CreateBox(
      `baseboard-${info.wall}`,
      { width: lengthM, height: TRIM_HEIGHT, depth: TRIM_DEPTH },
      this.scene,
    );
    mesh.material = this.ctx.systems.rendering.materials.trimMetal();
    this.finishTrim(mesh, center, this.wallRotation(info));
  }

  private buildAirlockFrame(info: WallInfo, point: Vec3): void {
    this.buildDoorFrame(info, point, 'airlock');
  }

  private buildDoorFrame(info: WallInfo, point: Vec3, tag: string): void {
    if (info.wall === 'floor' || info.wall === 'ceiling') return;
    const rotation = this.wallRotation(info);
    const normal = vec3ToBabylon(info.normal);
    const u = vec3ToBabylon(info.u);
    const v = vec3ToBabylon(info.v);
    // Push frames 0.02m proud of the baseboard plane to avoid coplanar z-fighting with the trim.
    const base = wallPointForPosition(info, point).subtract(normal.scale(0.02));

    const centerFrame = base.add(v.scale(DEFAULT_DOOR_HEIGHT / 2));
    const postSize = { width: DOOR_POST_WIDTH, height: DEFAULT_DOOR_HEIGHT, depth: TRIM_DEPTH };
    const lintelSize = { width: DEFAULT_DOOR_WIDTH + DOOR_POST_WIDTH * 2, height: DOOR_POST_WIDTH, depth: TRIM_DEPTH };

    const left = this.makeTrimBox(`frame-${tag}-left`, postSize);
    this.finishTrim(left, centerFrame.subtract(u.scale(DEFAULT_DOOR_WIDTH / 2 + DOOR_POST_WIDTH / 2)), rotation);

    const right = this.makeTrimBox(`frame-${tag}-right`, postSize);
    this.finishTrim(right, centerFrame.add(u.scale(DEFAULT_DOOR_WIDTH / 2 + DOOR_POST_WIDTH / 2)), rotation);

    const lintel = this.makeTrimBox(`frame-${tag}-top`, lintelSize);
    this.finishTrim(lintel, centerFrame.add(v.scale(DEFAULT_DOOR_HEIGHT / 2 + DOOR_POST_WIDTH / 2)), rotation);
  }

  private makeTrimBox(name: string, size: { width: number; height: number; depth: number }): Mesh {
    const mesh = MeshBuilder.CreateBox(name, size, this.scene);
    mesh.material = this.ctx.systems.rendering.materials.trimMetal();
    mesh.parent = this.root;
    mesh.checkCollisions = false;
    return mesh;
  }

  private finishTrim(mesh: Mesh, position: Vector3, rotation: Quaternion): void {
    mesh.position = position;
    mesh.rotationQuaternion = rotation;
    mesh.freezeWorldMatrix();
  }

  private buildSign(definition: ChamberDefinition, info: WallInfo, anchor: Vec3): void {
    if (info.wall === 'floor' || info.wall === 'ceiling') return;
    const plane = MeshBuilder.CreatePlane(
      `sign-${definition.id}`,
      { width: 2.0, height: 1.0, sideOrientation: Mesh.FRONTSIDE },
      this.scene,
    );
    const v = vec3ToBabylon(info.v);
    const normal = vec3ToBabylon(info.normal);

    const base = wallPointForPosition(info, anchor);
    plane.position = base.add(v.scale(2.5)).subtract(normal.scale(0.06));
    plane.rotationQuaternion = this.wallRotation(info);
    plane.parent = this.root;
    plane.checkCollisions = false;

    const { texture, material } = this.createSignMaterial(definition.name);
    plane.material = material;
    this.disposables.push(texture, material);
    plane.freezeWorldMatrix();
  }

  private createSignMaterial(title: string): { texture: DynamicTexture; material: StandardMaterial } {
    const width = 512;
    const height = 256;
    const texture = new DynamicTexture('signTexture', { width, height }, this.scene);
    const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;

    // Background
    ctx.fillStyle = '#1a1b1f';
    ctx.fillRect(0, 0, width, height);

    // Border
    ctx.strokeStyle = '#6ec1ff';
    ctx.lineWidth = 8;
    ctx.strokeRect(12, 12, width - 24, height - 24);

    // Chamber number
    ctx.fillStyle = '#e8e9eb';
    ctx.font = 'bold 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(title.toUpperCase(), width / 2, height / 2 - 24);

    // Aperture-style hazard triangle
    ctx.beginPath();
    ctx.moveTo(width / 2, height - 56);
    ctx.lineTo(width / 2 - 24, height - 28);
    ctx.lineTo(width / 2 + 24, height - 28);
    ctx.closePath();
    ctx.fillStyle = '#ff9a00';
    ctx.fill();

    texture.update();

    const material = new StandardMaterial(`signMat-${title}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveColor = new Color3(0.9, 0.92, 0.95);
    material.specularColor = new Color3(0.1, 0.1, 0.1);
    return { texture, material };
  }

  // ---------------------------------------------------------------------------
  // Observation glass facade
  // ---------------------------------------------------------------------------

  private buildObservationGlass(info: WallInfo): void {
    if (info.wall === 'floor' || info.wall === 'ceiling') return;
    const cols = Math.max(2, Math.floor(info.cols / 3));
    const rows = Math.max(2, Math.floor(info.rows / 2));
    const s = cols * this.panelSize;
    const h = rows * this.panelSize;
    const center = wallPoint(info, info.cols / 2 * this.panelSize, info.rows / 2 * this.panelSize);

    const visual = MeshBuilder.CreateBox(
      'observation-glass',
      { width: s, height: h, depth: 0.05 },
      this.scene,
    );
    visual.material = this.ctx.systems.rendering.materials.glass();
    visual.parent = this.root;
    visual.position = center.subtract(vec3ToBabylon(info.normal).scale(0.06));
    visual.rotationQuaternion = this.wallRotation(info);
    visual.checkCollisions = false;
    visual.metadata = { glass: true, portalable: false };
    visual.freezeWorldMatrix();
    this.disposables.push(visual);

    const handle = this.ctx.systems.physics.createStaticBox({
      id: 'observation-glass-proxy',
      size: new Vector3(s, h, 0.1),
      position: visual.position.clone(),
      rotation: visual.rotationQuaternion.clone(),
    });
    this.proxyHandles.push(handle);
    const proxy = this.ctx.systems.physics.getMeshForBody(handle);
    if (proxy) {
      proxy.isVisible = false;
      proxy.metadata = { glass: true, portalable: false };
    }
  }

  // ---------------------------------------------------------------------------
  // Lights
  // ---------------------------------------------------------------------------

  private buildCeilingLights(size: ChamberDefinition['size']): void {
    const strip = MeshBuilder.CreateBox(
      'ceiling-light-main',
      { width: size.width - 1, height: 0.08, depth: 0.4 },
      this.scene,
    );
    strip.material = this.ctx.systems.rendering.materials.emissive(new Color3(0.78, 0.86, 1.0), 1.2);
    strip.parent = this.root;
    strip.position = new Vector3(0, size.height - 0.04, 0);
    strip.checkCollisions = false;
    strip.freezeWorldMatrix();
  }
}

// ------------------------------------------------------------------------------
// Geometry helpers
// ------------------------------------------------------------------------------

function nearestWall(point: Vec3, size: ChamberDefinition['size'], panelSize: number): WallInfo {
  const w2 = size.width / 2;
  const d2 = size.depth / 2;
  const dists = new Map<WallId, number>([
    ['north', Math.abs(point.z - d2)],
    ['south', Math.abs(point.z + d2)],
    ['east', Math.abs(point.x - w2)],
    ['west', Math.abs(point.x + w2)],
  ]);
  let best: WallId = 'north';
  let bestD = Infinity;
  for (const [wall, d] of dists) {
    if (d < bestD) {
      best = wall;
      bestD = d;
    }
  }
  return wallInfo(best, size, panelSize);
}

function wallPoint(info: WallInfo, s: number, t: number): Vector3 {
  return vec3ToBabylon(info.origin)
    .add(vec3ToBabylon(info.u).scale(s))
    .add(vec3ToBabylon(info.v).scale(t))
    .subtract(vec3ToBabylon(info.normal).scale(0.04));
}

function wallPointForPosition(info: WallInfo, point: Vec3): Vector3 {
  const origin = vec3ToBabylon(info.origin);
  const u = vec3ToBabylon(info.u);
  const v = vec3ToBabylon(info.v);
  const p = vec3ToBabylon(point).subtract(origin);
  return wallPoint(info, Vector3.Dot(p, u), Vector3.Dot(p, v));
}

function vec3ToBabylon(v: Vec3): Vector3 {
  return new Vector3(v.x, v.y, v.z);
}

function deterministic(seed: number): number {
  // Stable 0..1 pseudo-random; no Math.random() so jitter is deterministic per chamber.
  let x = Math.sin(seed) * 10000;
  x -= Math.floor(x);
  return x;
}
