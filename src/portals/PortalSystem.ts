/**
 * portals/PortalSystem.ts — the signature mechanic.
 *
 * Firing: camera ray → (hops through open portals) → surface validation →
 * placement. Teleportation: every frame the player's and teleportable bodies'
 * positions are tested for portal-plane crossings; crossings apply the pair
 * transform with momentum conserved ("speedy thing goes in, speedy thing
 * comes out").
 */
import { Color3, Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import { CONFIG } from '../core/Config';
import {
  isWithinPortalBoundsFast,
  portalPairTransformToRef,
  signedDistanceToPortalPlaneFast,
  type PortalFrame,
} from '../core/math';
import { SOUND } from '../core/soundIds';
import type {
  IGameContext,
  IPortalHandle,
  IPortalSystem,
  Matrix4Like,
  PhysicsBodyHandle,
  PortalColor,
  QualityLevel,
} from '../core/types';
import { Portal, PORTAL_LAYER_MASK } from './Portal';
import { PortalGun } from './PortalGun';
import {
  FireCooldown,
  rayPortalCrossing,
  TeleportCooldowns,
  transformRayThroughPortal,
  validatePortalSurface,
  type PlacementRules,
} from './portalPlacement';

const MAX_RAY_HOPS = 2;
const PLAYER_ENTITY_ID = 'player';
/** |normal.y| above this → floor/ceiling-like surface (free portal orientation). */
const FLOOR_NORMAL_Y = 0.7;
/**
 * Extra distance beyond the capsule/body radius that still counts as
 * "touching" the portal plane. Covers the physics skin width: a capsule
 * pressed against a wall rests with its center ~radius+0.03 from the wall
 * face, so a center-PLANE crossing test can never fire for wall portals.
 */
const TOUCH_MARGIN = 0.08;

const PLACEMENT_RULES: PlacementRules = {
  minSurfaceWidth: CONFIG.portals.minSurfaceWidth,
  minSurfaceHeight: CONFIG.portals.minSurfaceHeight,
  minIncidenceDegrees: 15,
};

export class PortalSystem implements IPortalSystem {
  readonly name = 'portals';

  private ctx!: IGameContext;
  private blue!: Portal;
  private orange!: Portal;
  private gun: PortalGun | null = null;
  /** Pre-allocated [portal, linked] tuples — no per-frame generator garbage. */
  private pairs: Array<[Portal, Portal]> = [];
  private readonly cooldowns: Record<PortalColor, FireCooldown> = {
    blue: new FireCooldown(CONFIG.portals.fireCooldownSeconds),
    orange: new FireCooldown(CONFIG.portals.fireCooldownSeconds),
  };
  private readonly teleportCooldowns = new TeleportCooldowns(CONFIG.portals.teleportCooldownSeconds);
  private readonly unsubscribers: Array<() => void> = [];

  private elapsedSeconds = 0;
  private quality: QualityLevel = 'high';

  // Scratch — this system runs every frame for every entity; zero allocation.
  private readonly prevPlayerPos = Vector3.Zero();
  private playerPosInitialized = false;
  private readonly prevBodyPos = new Map<PhysicsBodyHandle, Vector3>();
  private readonly rayOrigin = Vector3.Zero();
  private readonly rayDir = Vector3.Zero();
  private readonly hopOrigin = Vector3.Zero();
  private readonly hopDir = Vector3.Zero();
  private readonly scratchUp = Vector3.Zero();
  private readonly scratchPair = Matrix.Identity();
  private readonly scratchBodyPos = Vector3.Zero();
  private readonly scratchBodyVel = Vector3.Zero();
  private readonly scratchBodyWorld = Matrix.Identity();
  private readonly scratchBodyResult = Matrix.Identity();
  private readonly scratchQuat = Quaternion.Identity();
  private readonly scratchScale = Vector3.One();

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.quality = ctx.settings.settings.quality;
    const rttSize = CONFIG.portals.rttSize[this.quality];
    const colors = CONFIG.portals.colors;
    this.blue = new Portal('blue', ctx.scene, rttSize, new Color3(colors.blue.r, colors.blue.g, colors.blue.b));
    this.orange = new Portal('orange', ctx.scene, rttSize, new Color3(colors.orange.r, colors.orange.g, colors.orange.b));
    this.blue.setLinkedPartner(this.orange);
    this.orange.setLinkedPartner(this.blue);
    this.pairs = [
      [this.blue, this.orange],
      [this.orange, this.blue],
    ];
    this.applyQualitySettings(this.quality);

    // The main camera must see the portal surface layers.
    const camera = ctx.systems.player.camera;
    camera.layerMask |= PORTAL_LAYER_MASK.blue | PORTAL_LAYER_MASK.orange;

    this.gun = new PortalGun(ctx);

    this.unsubscribers.push(
      ctx.events.on('input:fire', ({ color }) => this.fire(color)),
      ctx.events.on('settings:changed', ({ settings }) => {
        if (settings.quality !== this.quality) {
          this.quality = settings.quality;
          this.applyQualitySettings(settings.quality);
        }
      }),
    );
  }

  /** Quality scaling: RTT size, refresh rate, recursion depth. */
  private applyQualitySettings(quality: QualityLevel): void {
    const size = CONFIG.portals.rttSize[quality];
    this.blue.setRTTSize(size);
    this.orange.setRTTSize(size);
    // Half-rate RTT at medium/low; recursion (nested see-through) only where
    // recursionPasses >= 2 — below that, portals inside RTTs show the vortex.
    const refreshRate = quality === 'high' || quality === 'ultra' ? 1 : 2;
    this.blue.setRefreshRate(refreshRate);
    this.orange.setRefreshRate(refreshRate);
    const recursion = CONFIG.portals.recursionPasses[quality] >= 2;
    this.blue.setRecursionEnabled(recursion);
    this.orange.setRecursionEnabled(recursion);
  }

  // -------------------------------------------------------------------------
  // Firing + placement
  // -------------------------------------------------------------------------

  fire(color: PortalColor): void {
    if (!this.cooldowns[color].canFire(this.elapsedSeconds)) return;
    const { player, physics, audio } = this.ctx.systems;
    const camera = player.camera;

    this.cooldowns[color].recordFire(this.elapsedSeconds);
    this.ctx.events.emit('portal:fired', { color });
    audio.play(color === 'blue' ? SOUND.portalFireBlue : SOUND.portalFireOrange);

    // Ray from the camera: origin + forward read off the world matrix (no alloc).
    this.rayOrigin.copyFrom(camera.globalPosition);
    const wm = camera.getWorldMatrix();
    this.rayDir.set(wm.m[8], wm.m[9], wm.m[10]).normalize();

    // Travel through open portals (analytic — portal surfaces have no bodies).
    let hit = null;
    for (let hop = 0; hop <= MAX_RAY_HOPS; hop++) {
      hit = physics.raycast(this.rayOrigin, this.rayDir, CONFIG.portals.maxFireDistance);
      const crossed = this.nearestPortalCrossing(this.rayOrigin, this.rayDir, hit?.distance ?? CONFIG.portals.maxFireDistance);
      if (!crossed) break;
      const linked = crossed === this.blue ? this.orange : this.blue;
      transformRayThroughPortal(
        this.rayOrigin,
        this.rayDir,
        crossed.portalFrame!,
        linked.portalFrame!,
        CONFIG.portals.exitNudge,
        this.hopOrigin,
        this.hopDir,
      );
      this.rayOrigin.copyFrom(this.hopOrigin);
      this.rayDir.copyFrom(this.hopDir);
      hit = null;
    }

    if (!hit || !hit.mesh) return; // shot into the void: fizzle sound only

    const metadata = (hit.mesh.metadata ?? {}) as {
      portalable?: boolean;
      glass?: boolean;
      panelSize?: { width: number; height: number };
    };
    const verdict = validatePortalSurface(
      {
        portalable: metadata.portalable === true,
        isGlass: metadata.glass === true,
        runWidth: metadata.panelSize?.width ?? 0,
        runHeight: metadata.panelSize?.height ?? 0,
        incidenceCos: -Vector3.Dot(this.rayDir, hit.normal),
        isFloorLike: Math.abs(hit.normal.y) > FLOOR_NORMAL_Y,
      },
      PLACEMENT_RULES,
    );

    if (!verdict.ok) {
      this.ctx.events.emit('portal:placementFailed', { color, reason: verdict.reason ?? 'unknown' });
      audio.playAt(SOUND.portalFizzle, hit.point);
      return;
    }

    // Portal up: world-up projected for walls; camera-forward projected for
    // floors so the ellipse reads naturally to the shooter.
    if (Math.abs(hit.normal.y) > FLOOR_NORMAL_Y) {
      this.scratchUp.set(wm.m[8], wm.m[9], wm.m[10]);
    } else {
      this.scratchUp.set(0, 1, 0);
    }
    const alongNormal = Vector3.Dot(this.scratchUp, hit.normal);
    this.scratchUp.subtractInPlace(hit.normal.scale(alongNormal));
    if (this.scratchUp.lengthSquared() < 1e-8) this.scratchUp.set(0, 1, 0);
    this.scratchUp.normalize();

    const frame: PortalFrame = {
      position: hit.point.add(hit.normal.scale(CONFIG.portals.surfaceOffset)),
      normal: hit.normal.clone(),
      up: this.scratchUp.clone(),
    };

    const portal = color === 'blue' ? this.blue : this.orange;
    if (portal.isPlaced) {
      this.ctx.events.emit('portal:cleared', { color });
      audio.play(SOUND.portalClose);
      this.nudgeStraddlers(portal);
    }
    portal.place(frame, CONFIG.portals.width, CONFIG.portals.height);
    this.ctx.events.emit('portal:placed', { color, position: frame.position.clone(), normal: frame.normal.clone() });
    audio.playAt(SOUND.portalOpen, frame.position);
  }

  /** Nearest linked portal whose opening the ray crosses before maxT. */
  private nearestPortalCrossing(origin: Vector3, direction: Vector3, maxT: number): Portal | null {
    if (!this.isLinked) return null;
    let best: Portal | null = null;
    let bestT = maxT;
    for (const portal of [this.blue, this.orange]) {
      const frame = portal.portalFrame;
      if (!frame) continue;
      const t = rayPortalCrossing(
        origin,
        direction,
        frame,
        CONFIG.portals.width / 2,
        CONFIG.portals.height / 2,
        bestT,
      );
      if (t !== null && t < bestT) {
        best = portal;
        bestT = t;
      }
    }
    return best;
  }

  // -------------------------------------------------------------------------
  // Per-frame: portal visuals + teleportation
  // -------------------------------------------------------------------------

  update(dtSeconds: number): void {
    this.elapsedSeconds += dtSeconds;
    const { player, physics } = this.ctx.systems;
    const camera = player.camera;
    const engine = this.ctx.engine;
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());

    this.blue.update(dtSeconds, this.orange.isPlaced ? this.orange : null, camera, camera.fov, aspect);
    this.orange.update(dtSeconds, this.blue.isPlaced ? this.blue : null, camera, camera.fov, aspect);
    this.gun?.update(dtSeconds, player.velocity.length(), player.isGrounded);

    if (!this.isLinked) {
      this.prevPlayerPos.copyFrom(player.position);
      this.playerPosInitialized = true;
      return;
    }
    if (!this.playerPosInitialized) {
      this.prevPlayerPos.copyFrom(player.position);
      this.playerPosInitialized = true;
    }

    // --- Player crossing ---
    // Capsule-touch test: the capsule center can never REACH a wall portal's
    // plane (the wall stops it radius+skin short), so a center-crossing test
    // only ever worked for floor portals. Trigger when the capsule surface
    // touches the plane from the front side within the ellipse bounds. The
    // touch distance is the capsule's extent ALONG THE PORTAL NORMAL: radius
    // for wall portals, half-height for floor/ceiling portals (a capsule
    // standing on a floor portal has its center a full half-height away).
    const playerPos = player.position;
    const capsuleRadius = CONFIG.player.radius;
    const capsuleHalf = CONFIG.player.height / 2;
    for (const [portal, linked] of this.pairs) {
      const frame = portal.portalFrame!;
      const normalY = Math.abs(frame.normal.y);
      const playerTouch = capsuleRadius + (capsuleHalf - capsuleRadius) * normalY + TOUCH_MARGIN;
      const dCur = signedDistanceToPortalPlaneFast(playerPos, frame);
      const dPrev = signedDistanceToPortalPlaneFast(this.prevPlayerPos, frame);
      if (
        dPrev > 0 &&
        dCur <= playerTouch &&
        isWithinPortalBoundsFast(playerPos, frame, CONFIG.portals.width / 2, CONFIG.portals.height / 2) &&
        this.teleportCooldowns.canTeleport(PLAYER_ENTITY_ID, this.elapsedSeconds)
      ) {
        portalPairTransformToRef(frame, linked.portalFrame!, this.scratchPair);
        // Matrix.m is a Float32Array — structurally a Matrix4Like. The player
        // copies values out synchronously; the scratch is reused next frame.
        // Depth-aware nudge: the pair maps front-of-source to BEHIND-target,
        // so the exit must be pushed out by the entry depth (a floor entry at
        // the touch threshold is ~1m deep — a fixed 0.5 nudge leaves the
        // player embedded in the exit wall).
        player.teleportThroughPortal(
          this.scratchPair as unknown as Matrix4Like,
          linked.portalFrame!.normal,
          Math.max(0, dCur) + 0.06,
        );
        this.teleportCooldowns.recordTeleport(PLAYER_ENTITY_ID, this.elapsedSeconds);
        this.ctx.events.emit('player:teleported', { color: portal.color });
        this.ctx.systems.audio.playAt(SOUND.portalEnter, frame.position);
        this.ctx.systems.audio.playAt(SOUND.portalExit, linked.portalFrame!.position);
        break;
      }
    }
    this.prevPlayerPos.copyFrom(player.position);

    // --- Physics body crossings ---
    const teleportables = physics.getTeleportables();
    for (let i = 0; i < teleportables.length; i++) {
      const info = teleportables[i];
      if (physics.getIdleSeconds(info.handle) > CONFIG.physics.sleepTeleportThresholdSeconds) continue;
      let prev = this.prevBodyPos.get(info.handle);
      if (!prev) {
        prev = new Vector3();
        this.prevBodyPos.set(info.handle, prev);
        physics.getBodyPositionToRef(info.handle, prev);
        continue; // no history yet
      }
      if (!physics.getBodyPositionToRef(info.handle, this.scratchBodyPos)) continue;

      for (const [portal, linked] of this.pairs) {
        const frame = portal.portalFrame!;
        // Same capsule-touch model as the player: bodies pressed against a
        // wall portal never get their center across the plane.
        const dCur = signedDistanceToPortalPlaneFast(this.scratchBodyPos, frame);
        const dPrev = signedDistanceToPortalPlaneFast(prev, frame);
        if (
          dPrev <= 0 ||
          dCur > info.radius + TOUCH_MARGIN ||
          !isWithinPortalBoundsFast(this.scratchBodyPos, frame, CONFIG.portals.width / 2, CONFIG.portals.height / 2) ||
          !this.teleportCooldowns.canTeleport(info.id, this.elapsedSeconds)
        ) {
          continue;
        }
        portalPairTransformToRef(frame, linked.portalFrame!, this.scratchPair);
        // Pose: body world × pair, decomposed. (multiplyInPlace is Hadamard
        // in Babylon — multiplyToRef is the real matrix product.)
        const quat = physics.getBodyQuaternion(info.handle);
        Matrix.ComposeToRef(this.scratchScale, quat, this.scratchBodyPos, this.scratchBodyWorld);
        this.scratchBodyWorld.multiplyToRef(this.scratchPair, this.scratchBodyResult);
        this.scratchBodyResult.decompose(undefined, this.scratchQuat, this.scratchBodyPos);
        // The pair maps front-of-source to BEHIND-target: a body that touched
        // the entry plane (dCur ≤ radius) would materialize inside the exit
        // wall. Nudge it back out along the exit normal (same role as the
        // player's exitNudge, but depth-aware).
        linked.portalFrame!.normal.scaleToRef(Math.max(0, dCur) + 0.06, this.scratchUp);
        this.scratchBodyPos.addInPlace(this.scratchUp);
        physics.teleportBody(info.handle, this.scratchBodyPos, this.scratchQuat);
        // Momentum: rotate the velocity through the pair.
        if (physics.getLinearVelocityToRef(info.handle, this.scratchBodyVel)) {
          Vector3.TransformNormalToRef(this.scratchBodyVel, this.scratchPair, this.scratchBodyVel);
          physics.setLinearVelocity(info.handle, this.scratchBodyVel);
        }
        this.teleportCooldowns.recordTeleport(info.id, this.elapsedSeconds);
        this.ctx.events.emit('object:teleported', { objectId: info.id, color: portal.color });
        this.ctx.systems.audio.playAt(SOUND.objectTeleport, frame.position);
        prev.copyFrom(this.scratchBodyPos);
        break;
      }
      prev.copyFrom(this.scratchBodyPos);
    }
  }

  /** Push entities resting astride a portal out along its normal (on close/replace). */
  private nudgeStraddlers(portal: Portal): void {
    const frame = portal.portalFrame;
    if (!frame) return;
    const { physics, player } = this.ctx.systems;
    for (const info of physics.getTeleportables()) {
      if (!physics.getBodyPositionToRef(info.handle, this.scratchBodyPos)) continue;
      const dist = signedDistanceToPortalPlaneFast(this.scratchBodyPos, frame);
      if (Math.abs(dist) >= info.radius) continue;
      if (!isWithinPortalBoundsFast(this.scratchBodyPos, frame, CONFIG.portals.width / 2, CONFIG.portals.height / 2)) continue;
      const push = (info.radius - Math.abs(dist) + 0.02) * (dist >= 0 ? 1 : -1);
      this.scratchBodyPos.addInPlace(frame.normal.scale(push));
      physics.teleportBody(info.handle, this.scratchBodyPos, physics.getBodyQuaternion(info.handle));
    }
    // The player straddling a closing portal gets shoved out too (velocity
    // nudge — the player interface has no positional displace; a few frames
    // of external velocity clears the plane).
    const playerDist = signedDistanceToPortalPlaneFast(player.position, frame);
    if (
      Math.abs(playerDist) < CONFIG.player.radius &&
      isWithinPortalBoundsFast(player.position, frame, CONFIG.portals.width / 2, CONFIG.portals.height / 2)
    ) {
      const shove = 3 * (playerDist >= 0 ? 1 : -1);
      player.addExternalVelocity(frame.normal.scale(shove));
    }
  }

  // -------------------------------------------------------------------------

  getPortal(color: PortalColor): IPortalHandle | null {
    const portal = color === 'blue' ? this.blue : this.orange;
    const frame = portal.portalFrame;
    if (!portal.isPlaced || !frame) return null;
    return { color, isPlaced: true, position: frame.position, normal: frame.normal, up: frame.up };
  }

  get isLinked(): boolean {
    return this.blue.isPlaced && this.orange.isPlaced;
  }

  clearAll(): void {
    for (const portal of [this.blue, this.orange]) {
      if (portal.isPlaced) {
        this.nudgeStraddlers(portal);
        portal.close();
        this.ctx.events.emit('portal:cleared', { color: portal.color });
      }
    }
    this.ctx.systems.audio.play(SOUND.portalClose);
    this.teleportCooldowns.clear();
    this.prevBodyPos.clear();
  }

  isPortalable(mesh: AbstractMesh): boolean {
    return (mesh.metadata as { portalable?: boolean } | null)?.portalable === true;
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.gun?.dispose();
    this.blue.dispose();
    this.orange.dispose();
    this.prevBodyPos.clear();
  }
}
