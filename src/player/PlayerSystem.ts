/**
 * player/PlayerSystem.ts — Portal 2-feel first-person controller.
 *
 * Built on Babylon's PhysicsCharacterController: WE own the velocity vector
 * (manual gravity, jump, friction/accel from Config); the controller owns
 * collision, stepping and slope constraints. The camera is driven directly —
 * yaw/pitch state lives here, bob/kick/roll are cosmetic offsets applied on
 * top of the eye position every frame.
 */
import { Matrix, UniversalCamera, Vector3 } from '@babylonjs/core';
import { PhysicsCharacterController, CharacterSupportedState } from '@babylonjs/core/Physics/v2/characterController';
import type { CharacterSurfaceInfo } from '@babylonjs/core/Physics/v2/characterController';
import type { InputManager } from '../core/InputManager';
import { SOUND } from '../core/soundIds';
import { clamp, damp } from '../core/math';
import type {
  GameSettings,
  IGameContext,
  IPlayerSystem,
  Matrix4Like,
  PhysicsBodyHandle,
  SpawnTransform,
} from '../core/types';
import {
  accelerate,
  advanceBobPhase,
  applyFriction,
  applyLookDelta,
  bobOffset,
  carryVelocity,
  computeWishDirection,
  crossedStepBoundary,
  JumpController,
  landingKickAmount,
  targetFovRadians,
  yawPitchFromForward,
  type LookAngles,
} from './movementMath';

const DEG2RAD = Math.PI / 180;
const SPRINT_FOV_KICK_DEG = 4;
const INTERACT_SCAN_SECONDS = 0.1;
const CARRY_YANK_DISTANCE_FACTOR = 2.5;
const FALL_DEATH_Y = -30;
const EYE_DAMP_LAMBDA = 18;
const FOV_DAMP_LAMBDA = 10;
const ROLL_DAMP_LAMBDA = 8;
const LAND_DIP_LAMBDA = 7;
const LAND_DIP_MAX = 0.14;

interface CarriedObject {
  handle: PhysicsBodyHandle;
  objectId: string;
}

export class PlayerSystem implements IPlayerSystem {
  readonly name = 'player';

  private ctx!: IGameContext;
  private cam!: UniversalCamera;
  private controller!: PhysicsCharacterController;
  private settings!: GameSettings;
  private unsubscribeSettings: (() => void) | null = null;
  private readonly unsubscribeInput: Array<() => void> = [];

  // Simulation state
  private readonly simVelocity = Vector3.Zero();
  private readonly externalVelocity = Vector3.Zero();
  private yaw = 0;
  private pitch = 0;
  private readonly lookResult: LookAngles = { yaw: 0, pitch: 0 };
  private active = false;
  private grounded = false;
  private wasGrounded = false;
  /** True from takeoff until the CC reports unsupported (or upward motion ends)
   * — masks the phantom SUPPORTED state the CC returns while the capsule is
   * still inside its support-snap distance right after a jump. */
  private jumpAirborne = false;
  private crouched = false;
  private eyeAboveCenter = 0;
  private standEyeAboveCenter = 0;
  private crouchEyeAboveCenter = 0;
  private readonly jump = new JumpController();
  private jumpPressed = false;
  private interactPressed = false;
  private fellToDeath = false;

  // Cosmetic state
  private bobPhase = 0;
  private currentFovRadians = 0;
  private landDip = 0;
  private strafeRoll = 0;

  // Interaction state
  private interactScanTimer = 0;
  private promptTargetId: string | null = null;
  private carried: CarriedObject | null = null;

  // Scratch (no per-frame allocation)
  private readonly wishDir = Vector3.Zero();
  private readonly forward = Vector3.Zero();
  private readonly holdPoint = Vector3.Zero();
  private readonly carryVel = Vector3.Zero();
  private readonly bobVec = Vector3.Zero();
  private readonly camPos = Vector3.Zero();
  private readonly scratchA = Vector3.Zero();
  private readonly scratchB = Vector3.Zero();
  private readonly scratchMatrix = Matrix.Identity();
  private readonly downVector = new Vector3(0, -1, 0);
  private readonly upVector = new Vector3(0, 1, 0);
  private readonly gravityVec = Vector3.Zero();
  private readonly surfaceInfo: CharacterSurfaceInfo = {
    isSurfaceDynamic: false,
    supportedState: CharacterSupportedState.UNSUPPORTED,
    averageSurfaceNormal: new Vector3(0, 1, 0),
    averageSurfaceVelocity: Vector3.Zero(),
    averageAngularSurfaceVelocity: Vector3.Zero(),
  };

  constructor(private readonly input: InputManager) {}

  get camera(): UniversalCamera {
    return this.cam;
  }
  get position(): Vector3 {
    return this.controller ? this.controller.getPosition() : Vector3.Zero();
  }
  get velocity(): Vector3 {
    return this.simVelocity;
  }
  get isGrounded(): boolean {
    return this.grounded;
  }

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.settings = ctx.settings.settings;
    const cfg = ctx.config.player;

    // Eye offset above the capsule CENTER (controller.getPosition() returns
    // the center): feet sit height/2 below the center, the eye sits
    // eyeOffsetFromTop below the head top.
    this.standEyeAboveCenter = cfg.height / 2 - cfg.eyeOffsetFromTop;
    this.crouchEyeAboveCenter = cfg.crouchHeight / 2 - cfg.eyeOffsetFromTop;
    this.eyeAboveCenter = this.standEyeAboveCenter;
    this.currentFovRadians = this.settings.fovDegrees * DEG2RAD;
    this.gravityVec.set(0, -cfg.gravity, 0);

    this.cam = new UniversalCamera('playerCamera', new Vector3(0, this.standEyeAboveCenter, 0), ctx.scene);
    this.cam.minZ = 0.05;
    this.cam.fov = this.currentFovRadians;
    ctx.scene.activeCamera = this.cam;

    this.controller = new PhysicsCharacterController(
      new Vector3(0, cfg.height / 2, 0),
      { capsuleHeight: cfg.height, capsuleRadius: cfg.radius },
      ctx.scene,
    );
    this.controller.maxSlopeCosine = Math.cos(cfg.maxSlopeDegrees * DEG2RAD);
    this.controller.maxStepHeight = cfg.stepHeight;
    // Portal shots and interact rays must not hit the player's own capsule.
    // The controller's body is TS-private but runtime-accessible.
    const ccBody = (this.controller as unknown as { _body?: import('@babylonjs/core/Physics/v2/physicsBody').PhysicsBody })._body;
    if (ccBody) {
      (ctx.systems.physics as { registerRaycastIgnore?: (b: typeof ccBody) => void }).registerRaycastIgnore?.(ccBody);
    }

    this.unsubscribeSettings = ctx.events.on('settings:changed', ({ settings }) => {
      this.settings = settings;
    });
    this.unsubscribeInput.push(
      this.input.onPress('jump', () => {
        this.jumpPressed = true;
      }),
      this.input.onPress('interact', () => {
        this.interactPressed = true;
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Frame update
  // -------------------------------------------------------------------------

  update(dtSeconds: number): void {
    if (!this.active || dtSeconds <= 0) return;
    const cfg = this.ctx.config.player;

    this.updateLook();
    this.updateCrouch(dtSeconds);

    // --- support / grounded ---
    this.controller.checkSupportToRef(dtSeconds, this.downVector, this.surfaceInfo);
    const supported = this.surfaceInfo.supportedState === CharacterSupportedState.SUPPORTED;
    // The CC keeps reporting SUPPORTED for a frame or two after takeoff (the
    // capsule is still inside its support-snap distance). Mask that phantom
    // support, otherwise the landing logic below sees a fake air→ground
    // transition and zeroes the jump velocity one frame after takeoff.
    if (!supported || this.simVelocity.y <= 0) this.jumpAirborne = false;
    this.grounded = supported && !this.jumpAirborne;

    // --- horizontal movement ---
    const forwardAxis = (this.input.isHeld('moveForward') ? 1 : 0) - (this.input.isHeld('moveBackward') ? 1 : 0);
    const rightAxis = (this.input.isHeld('moveRight') ? 1 : 0) - (this.input.isHeld('moveLeft') ? 1 : 0);
    computeWishDirection(this.yaw, forwardAxis, rightAxis, this.wishDir);
    const sprinting = this.input.isHeld('sprint') && !this.crouched && forwardAxis > 0;
    const targetSpeed = this.crouched ? cfg.crouchSpeed : sprinting ? cfg.sprintSpeed : cfg.walkSpeed;

    if (this.grounded) {
      applyFriction(this.simVelocity, cfg.friction, dtSeconds);
      accelerate(this.simVelocity, this.wishDir, targetSpeed, cfg.acceleration, dtSeconds);
    } else {
      accelerate(this.simVelocity, this.wishDir, targetSpeed, cfg.airAcceleration, dtSeconds);
    }

    // --- vertical movement (we own velocity.y; integrate gets gravity only
    // for contact resolution — see characterController._resolveContacts) ---
    // Capture the fall speed BEFORE we clamp it: on the landing frame the
    // controller has already brought us to rest, but simVelocity.y still
    // holds the downward speed we entered the floor with (set last frame).
    const justLanded = !this.wasGrounded && this.grounded;
    const landingImpact = justLanded ? Math.max(0, -this.simVelocity.y) : 0;
    const jumped = this.jump.update(dtSeconds, this.grounded, this.jumpPressed);
    if (jumped) {
      this.simVelocity.y = cfg.jumpVelocity;
      this.grounded = false;
      this.jumpAirborne = true;
      this.ctx.systems.audio.play(SOUND.playerJump);
    }
    this.jumpPressed = false;
    if (this.grounded) {
      if (this.simVelocity.y < 0) this.simVelocity.y = 0;
    } else {
      this.simVelocity.y -= cfg.gravity * dtSeconds;
    }

    // --- external influences (funnels, platforms) ---
    this.simVelocity.addInPlace(this.externalVelocity);
    this.externalVelocity.setAll(0);

    // --- integrate ---
    this.controller.setVelocity(this.simVelocity);
    this.controller.integrate(dtSeconds, this.surfaceInfo, this.gravityVec);

    // Landing: air → ground transition. Skip if a buffered jump fired this
    // frame (bunny-hop): the player left the ground instead of landing.
    if (justLanded && !jumped) {
      this.onLanded(landingImpact);
      this.simVelocity.y = 0;
    }
    this.wasGrounded = this.grounded;

    this.updateCamera(dtSeconds, sprinting);
    this.updateInteraction(dtSeconds);
    this.updateCarried();

    // --- fall death ---
    const y = this.controller.getPosition().y;
    if (y < FALL_DEATH_Y && !this.fellToDeath) {
      this.fellToDeath = true;
      this.dropCarried(false);
      this.ctx.events.emit('player:died', { cause: 'fall' });
    }
  }

  private updateLook(): void {
    const cfg = this.ctx.config.player;
    const { dx, dy } = this.input.consumeMouseDelta();
    if (dx === 0 && dy === 0) return;
    applyLookDelta(
      this.lookResult,
      this.yaw,
      this.pitch,
      dx,
      dy,
      cfg.mouseBaseSensitivity * this.settings.mouseSensitivity,
      this.settings.invertY,
      cfg.pitchLimitDegrees * DEG2RAD,
    );
    this.yaw = this.lookResult.yaw;
    this.pitch = this.lookResult.pitch;
  }

  private updateCrouch(dtSeconds: number): void {
    const cfg = this.ctx.config.player;
    const wantsCrouch = this.input.isHeld('crouch');
    if (wantsCrouch && !this.crouched) {
      this.crouched = true;
      this.controller.setShapeOptions({ capsuleHeight: cfg.crouchHeight, capsuleRadius: cfg.radius }, true);
    } else if (!wantsCrouch && this.crouched) {
      // Only stand when there is headroom.
      const pos = this.controller.getPosition();
      this.scratchA.set(pos.x, pos.y + cfg.crouchHeight / 2, pos.z);
      const blocked = this.ctx.systems.physics.raycast(this.scratchA, this.upVector, cfg.height - cfg.crouchHeight);
      if (!blocked) {
        this.crouched = false;
        this.controller.setShapeOptions({ capsuleHeight: cfg.height, capsuleRadius: cfg.radius }, true);
      }
    }
    const targetEye = this.crouched ? this.crouchEyeAboveCenter : this.standEyeAboveCenter;
    this.eyeAboveCenter = damp(this.eyeAboveCenter, targetEye, EYE_DAMP_LAMBDA, dtSeconds);
  }

  private updateCamera(dtSeconds: number, sprinting: boolean): void {
    const cfg = this.ctx.config.player;
    const pos = this.controller.getPosition();

    // FOV: base from settings + sprint kick.
    const baseFov = this.settings.fovDegrees * DEG2RAD;
    const target = targetFovRadians(baseFov, sprinting, SPRINT_FOV_KICK_DEG * DEG2RAD);
    this.currentFovRadians = damp(this.currentFovRadians, target, FOV_DAMP_LAMBDA, dtSeconds);
    this.cam.fov = this.currentFovRadians;

    // Head bob + footstep events.
    const horizontalSpeed = Math.hypot(this.simVelocity.x, this.simVelocity.z);
    if (this.grounded && horizontalSpeed > 0.5) {
      const prev = this.bobPhase;
      this.bobPhase = advanceBobPhase(this.bobPhase, horizontalSpeed, dtSeconds, cfg.headBobFrequency);
      if (crossedStepBoundary(prev, this.bobPhase)) {
        this.ctx.events.emit('player:step', { speed: horizontalSpeed });
        this.ctx.systems.audio.play(SOUND.playerStep, { pitch: 0.92 + Math.random() * 0.16 });
      }
    }
    bobOffset(this.bobPhase, cfg.headBobAmplitude * clamp(horizontalSpeed / cfg.walkSpeed, 0, 1.4), this.bobVec);

    // Landing dip decays back to zero.
    this.landDip = damp(this.landDip, 0, LAND_DIP_LAMBDA, dtSeconds);

    // Subtle strafe roll.
    const rightAxis = (this.input.isHeld('moveRight') ? 1 : 0) - (this.input.isHeld('moveLeft') ? 1 : 0);
    this.strafeRoll = damp(this.strafeRoll, -rightAxis * 0.012, ROLL_DAMP_LAMBDA, dtSeconds);

    // Compose: eye position + yaw-rotated bob - landing dip.
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    this.camPos.set(
      pos.x + cos * this.bobVec.x,
      pos.y + this.eyeAboveCenter + this.bobVec.y - this.landDip,
      pos.z - sin * this.bobVec.x,
    );
    this.cam.position.copyFrom(this.camPos);
    this.cam.rotation.set(this.pitch, this.yaw, this.strafeRoll + this.bobVec.x * 0.35);
  }

  private onLanded(impactSpeed: number): void {
    if (impactSpeed < 1) return;
    this.ctx.events.emit('player:landed', { impactSpeed });
    this.ctx.systems.audio.play(SOUND.playerLand, { volume: clamp(impactSpeed / 12, 0.2, 1) });
    const kick = landingKickAmount(impactSpeed, this.ctx.config.player.landShakeThreshold);
    if (kick > 0) {
      this.landDip = kick * LAND_DIP_MAX;
      this.ctx.systems.rendering.shake(kick * 0.6);
    }
  }

  // -------------------------------------------------------------------------
  // Interaction + carrying
  // -------------------------------------------------------------------------

  private updateInteraction(dtSeconds: number): void {
    this.interactScanTimer -= dtSeconds;
    if (this.interactScanTimer <= 0) {
      this.interactScanTimer = INTERACT_SCAN_SECONDS;
      this.scanInteractTarget();
    }
    if (this.interactPressed) {
      this.interactPressed = false;
      this.onInteractPressed();
    }
  }

  private scanInteractTarget(): void {
    if (this.carried) {
      this.setPrompt('__carrying__', '[E] Drop');
      return;
    }
    this.cameraForward(this.forward);
    const hit = this.ctx.systems.physics.raycast(this.cam.position, this.forward, this.ctx.config.player.interactDistance);
    const meta = hit?.mesh?.metadata as Record<string, unknown> | null | undefined;
    if (meta?.grabbable === true && typeof meta.bodyHandle === 'string' && typeof meta.objectId === 'string') {
      this.setPrompt(`grab:${meta.objectId}`, '[E] Pick up');
      this.promptTargetId = null;
      this.promptGrabbable = { handle: meta.bodyHandle, objectId: meta.objectId };
      return;
    }
    if (typeof meta?.interactableId === 'string') {
      this.setPrompt(meta.interactableId, typeof meta.interactPrompt === 'string' ? meta.interactPrompt : '[E] Use');
      this.promptTargetId = meta.interactableId;
      this.promptGrabbable = null;
      return;
    }
    this.setPrompt(null, null);
    this.promptTargetId = null;
    this.promptGrabbable = null;
  }

  private promptGrabbable: CarriedObject | null = null;
  private lastPromptText: string | null = null;

  private setPrompt(_key: string | null, text: string | null): void {
    if (text === this.lastPromptText) return; // emit on change only
    this.lastPromptText = text;
    this.ctx.events.emit('player:interactPrompt', { text });
  }

  private onInteractPressed(): void {
    if (this.carried) {
      this.dropCarried(this.isMovingFast());
      return;
    }
    if (this.promptGrabbable) {
      this.carried = { ...this.promptGrabbable };
      this.ctx.events.emit('object:grabbed', { objectId: this.carried.objectId });
      this.ctx.systems.audio.play(SOUND.cubePickup);
      return;
    }
    if (this.promptTargetId) {
      this.ctx.events.emit('player:interacted', { targetId: this.promptTargetId });
    }
  }

  private isMovingFast(): boolean {
    const cfg = this.ctx.config.player;
    return Math.hypot(this.simVelocity.x, this.simVelocity.z) > cfg.sprintSpeed * 0.7;
  }

  private updateCarried(): void {
    if (!this.carried) return;
    const cfg = this.ctx.config.player;
    const physics = this.ctx.systems.physics;
    // Prefer the concrete system's zero-allocation getter when available.
    const toRef = (physics as { getBodyPositionToRef?: (h: PhysicsBodyHandle, out: Vector3) => boolean }).getBodyPositionToRef;
    if (toRef) {
      if (!toRef.call(physics, this.carried.handle, this.scratchA)) {
        this.carried = null; // body vanished (fizzled)
        return;
      }
    } else {
      this.scratchA.copyFrom(physics.getBodyPosition(this.carried.handle));
    }
    this.cameraForward(this.forward);
    this.holdPoint.copyFrom(this.cam.position);
    this.forward.scaleToRef(cfg.carryDistance, this.scratchB);
    this.holdPoint.addInPlace(this.scratchB);
    // Yank-out: object dragged too far from the hold point (through a wall).
    if (Vector3.DistanceSquared(this.scratchA, this.holdPoint) > cfg.carryDistance * CARRY_YANK_DISTANCE_FACTOR ** 2) {
      this.dropCarried(false);
      return;
    }
    carryVelocity(this.holdPoint, this.scratchA, cfg.carryLerp, cfg.throwImpulse * 2, this.carryVel);
    physics.setLinearVelocity(this.carried.handle, this.carryVel);
  }

  private dropCarried(thrown: boolean): void {
    if (!this.carried) return;
    const physics = this.ctx.systems.physics;
    if (thrown) {
      this.cameraForward(this.forward);
      physics.setLinearVelocity(this.carried.handle, this.forward.scale(this.ctx.config.player.throwImpulse));
    }
    this.ctx.events.emit('object:released', { objectId: this.carried.objectId, thrown });
    this.ctx.systems.audio.play(SOUND.cubeDrop);
    this.carried = null;
  }

  /** Camera forward from yaw/pitch (Babylon convention) into `out`. */
  private cameraForward(out: Vector3): Vector3 {
    const cosP = Math.cos(this.pitch);
    out.set(cosP * Math.sin(this.yaw), -Math.sin(this.pitch), cosP * Math.cos(this.yaw));
    return out;
  }

  // -------------------------------------------------------------------------
  // Contract methods
  // -------------------------------------------------------------------------

  teleportThroughPortal(worldTransform: Matrix4Like, linkedNormal: Vector3, exitNudge?: number): void {
    // Rebuild the pair transform into a scratch matrix (row-major: matches
    // core/math portalPairTransform, which builds via Matrix.FromValues).
    Matrix.FromArrayToRef(worldTransform.m, 0, this.scratchMatrix);
    // Position is a point (w=1): translation applies.
    const pos = this.controller.getPosition();
    Vector3.TransformCoordinatesToRef(pos, this.scratchMatrix, this.scratchA);
    // Velocity + facing are directions (w=0). TransformNormalToRef reads the
    // source into locals before writing, so an in-place transform is safe.
    // "Speedy thing goes in, speedy thing comes out": magnitude is preserved
    // because the pair transform is a pure rotation + translation.
    Vector3.TransformNormalToRef(this.simVelocity, this.scratchMatrix, this.simVelocity);
    this.cameraForward(this.forward);
    Vector3.TransformNormalToRef(this.forward, this.scratchMatrix, this.forward);
    const angles = yawPitchFromForward(this.forward);
    this.yaw = angles.yaw;
    this.pitch = angles.pitch;
    // Exit nudge offsets the capsule clear of the exit portal plane along the
    // linked normal (position only — speed is unaffected). The caller passes
    // a depth-aware value (floor entries need ~1m; wall entries ~0.5m).
    linkedNormal.scaleToRef(exitNudge ?? this.ctx.config.portals.exitNudge, this.scratchB);
    this.scratchA.addInPlace(this.scratchB);
    this.controller.setPosition(this.scratchA);
    // Release any carried object; the portal system teleports it separately.
    this.dropCarried(false);
    this.jumpAirborne = false; // support state is unknown on the far side
    this.wasGrounded = false; // re-arm landing detection on the far side
  }

  placeAt(spawn: SpawnTransform): void {
    const cfg = this.ctx.config.player;
    // spawn.position is the EYE/camera position: chambers author spawn at
    // head height (y ≈ cfg.height, e.g. 1.8). The capsule center sits
    // (height/2 − eyeOffsetFromTop) below the eye so the camera lands there.
    const eyeAboveCenter = cfg.height / 2 - cfg.eyeOffsetFromTop;
    this.controller.setPosition(
      this.scratchA.set(spawn.position.x, spawn.position.y - eyeAboveCenter, spawn.position.z),
    );
    this.simVelocity.setAll(0);
    this.externalVelocity.setAll(0);
    this.yaw = spawn.yawDegrees * DEG2RAD;
    this.pitch = 0;
    this.jump.reset();
    this.jumpAirborne = false;
    this.fellToDeath = false;
    this.dropCarried(false);
    this.wasGrounded = true;
    this.ctx.events.emit('player:spawned', { position: spawn.position });
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.jumpPressed = false;
      this.interactPressed = false;
      this.externalVelocity.setAll(0);
    }
  }

  launch(velocity: Vector3): void {
    this.simVelocity.copyFrom(velocity);
    this.grounded = false;
    // Same phantom-support mask as a jump: without it, the CC's lingering
    // SUPPORTED state reads as a landing next frame and zeroes the launch
    // velocity (faith plates fired but the player never moved).
    this.jumpAirborne = true;
    this.wasGrounded = false;
  }

  addExternalVelocity(velocity: Vector3): void {
    this.externalVelocity.addInPlace(velocity);
  }

  dispose(): void {
    this.unsubscribeSettings?.();
    for (const unsub of this.unsubscribeInput) unsub();
    this.controller?.dispose();
    this.cam?.dispose();
  }
}
