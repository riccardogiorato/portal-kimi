/**
 * portals/Portal.ts — one placed portal: ring + see-through surface + RTT +
 * virtual camera, with open/close animation.
 *
 * Rendering technique: the surface samples the LINKED portal's RTT in screen
 * space. Both RTTs render every frame, so portal-in-portal recursion emerges
 * naturally with a one-frame feedback lag (no explicit recursion passes, no
 * infinite loop). The virtual camera sits behind the exit portal (the pair
 * transform maps front-of-source to behind-target) and uses an oblique
 * near-plane so geometry behind the exit wall never leaks into the view.
 */
import {
  Color3,
  Matrix,
  Mesh,
  MeshBuilder,
  Quaternion,
  RenderTargetTexture,
  Scene,
  ShaderMaterial,
  StandardMaterial,
  TransformNode,
  UniversalCamera,
  Vector2,
  Vector3,
} from '@babylonjs/core';
import type { Observer } from '@babylonjs/core';
import { makeObliqueProjectionToRef, portalFrameToMatrix, portalPairTransformToRef, type PortalFrame } from '../core/math';
import type { PortalColor } from '../core/types';
import { PORTAL_FRAGMENT, PORTAL_VERTEX } from './portalShaders';

/** Layer masks from docs/SOUND_IDS.md: blue 0x20000000, orange 0x40000000. */
export const PORTAL_LAYER_MASK: Record<PortalColor, number> = {
  blue: 0x20000000,
  orange: 0x40000000,
};
export const DEFAULT_LAYER_MASK = 0x0fffffff;

const RING_THICKNESS = 0.055;
const OPEN_SECONDS = 0.22;
const CLOSE_SECONDS = 0.14;

type PortalState = 'closed' | 'opening' | 'open' | 'closing';

export class Portal {
  readonly color: PortalColor;

  private readonly scene: Scene;
  private readonly root: TransformNode;
  private readonly ring: Mesh;
  private readonly surface: Mesh;
  private readonly surfaceMaterial: ShaderMaterial;
  private readonly virtualCamera: UniversalCamera;
  private rtt: RenderTargetTexture | null = null;

  private frame: PortalFrame | null = null;
  private state: PortalState = 'closed';
  private animT = 0;
  private time = 0;

  // Scratch (no per-frame allocation).
  private readonly scratchPair = Matrix.Identity();
  private readonly scratchWorld = Matrix.Identity();
  private readonly scratchProj = Matrix.Identity();
  private readonly scratchOblique = Matrix.Identity();
  private readonly scratchViewport = Vector2.Zero();
  private readonly scratchPlaneNormal = Vector3.Zero();
  private readonly scratchPlanePoint = Vector3.Zero();
  private assignedRTT: RenderTargetTexture | null = null;
  private rttObservers: Array<Observer<number>> = [];
  private linkedPartner: Portal | null = null;
  /** Quality-gated: false → portals inside RTT views render as vortex (depth 1). */
  private recursionEnabled = true;
  private refreshRate: number;

  constructor(color: PortalColor, scene: Scene, rttSize: number, tint: Color3, refreshRate = 1) {
    this.color = color;
    this.scene = scene;
    this.root = new TransformNode(`portal-${color}-root`, scene);

    // Ring: torus built around Y (ring in XZ plane), rotated to face +Z,
    // then scaled into an ellipse (local X→width, local Z→height).
    this.ring = MeshBuilder.CreateTorus(
      `portal-${color}-ring`,
      { diameter: 1, thickness: RING_THICKNESS, tessellation: 64 },
      scene,
    );
    this.ring.rotation.x = Math.PI / 2;
    const ringMaterial = new StandardMaterial(`portal-${color}-ringmat`, scene);
    ringMaterial.emissiveColor = tint;
    ringMaterial.disableLighting = true;
    this.ring.material = ringMaterial;
    this.ring.parent = this.root;

    // Surface: unit disc scaled to the portal ellipse, custom shader.
    this.surface = MeshBuilder.CreateDisc(`portal-${color}-surface`, { radius: 0.5, tessellation: 48 }, scene);
    this.surface.layerMask = PORTAL_LAYER_MASK[color];
    this.surface.metadata = { portalColor: color, portalable: false };
    this.surfaceMaterial = new ShaderMaterial(
      `portal-${color}-surfmat`,
      scene,
      { vertexSource: PORTAL_VERTEX, fragmentSource: PORTAL_FRAGMENT },
      {
        attributes: ['position', 'uv'],
        uniforms: ['worldViewProjection', 'viewportSize', 'portalColor', 'time', 'linked'],
        samplers: ['rttSampler'],
      },
    );
    this.surfaceMaterial.setColor3('portalColor', tint);
    this.surfaceMaterial.setFloat('linked', 0);
    this.surface.material = this.surfaceMaterial;
    this.surface.parent = this.root;

    this.virtualCamera = new UniversalCamera(`portal-${color}-vcam`, Vector3.Zero(), scene);
    this.virtualCamera.layerMask = DEFAULT_LAYER_MASK | PORTAL_LAYER_MASK[color === 'blue' ? 'orange' : 'blue'];

    this.refreshRate = refreshRate;
    this.createRTT(rttSize);
    this.root.setEnabled(false);
  }

  /** The other portal of the pair — assigned by PortalSystem after construction. */
  setLinkedPartner(partner: Portal): void {
    this.linkedPartner = partner;
  }

  /**
   * Quality gate for portal-in-portal depth. When disabled, the partner's
   * surface renders as a vortex INSIDE this portal's RTT (depth-1 only);
   * when enabled, the feedback RTT sampling yields nested see-through views.
   */
  setRecursionEnabled(enabled: boolean): void {
    this.recursionEnabled = enabled;
  }

  /** Live RTT refresh-rate change (quality scaling; no recreation needed). */
  setRefreshRate(rate: number): void {
    this.refreshRate = rate;
    if (this.rtt) this.rtt.refreshRate = rate;
  }

  get isPlaced(): boolean {
    return this.state !== 'closed';
  }

  get portalFrame(): PortalFrame | null {
    return this.frame;
  }

  get renderTarget(): RenderTargetTexture | null {
    return this.rtt;
  }

  /** RTT camera layer mask excludes this portal's OWN surface (no self-view). */
  get camera(): UniversalCamera {
    return this.virtualCamera;
  }

  setRTTSize(size: number): void {
    this.disposeRTT();
    this.createRTT(size);
  }

  place(frame: PortalFrame, width: number, height: number): void {
    this.frame = {
      position: frame.position.clone(),
      normal: frame.normal.clone(),
      up: frame.up.clone(),
    };
    this.root.setEnabled(true);
    // Orient: portal local +Z == frame normal (see portalFrameToMatrix).
    const world = portalFrameToMatrix(this.frame);
    world.decompose(undefined, this.root.rotationQuaternion ?? (this.root.rotationQuaternion = Quaternion.Identity()), this.root.position);
    this.ring.scaling.set(width, 1, height);
    this.surface.scaling.set(width, height, 1);
    this.state = 'opening';
    this.animT = 0;
  }

  close(): void {
    if (this.state === 'closed' || this.state === 'closing') return;
    this.state = 'closing';
    this.animT = 0;
  }

  /**
   * Per-frame: advance animation, then (when linked) pose the virtual camera
   * through the pair and freeze the oblique projection for this frame's RTT.
   */
  update(dtSeconds: number, linked: Portal | null, mainCamera: UniversalCamera, fov: number, aspect: number): void {
    this.time += dtSeconds;
    this.surfaceMaterial.setFloat('time', this.time);

    switch (this.state) {
      case 'opening':
        this.animT = Math.min(1, this.animT + dtSeconds / OPEN_SECONDS);
        this.root.scaling.setAll(easeOutBack(this.animT));
        if (this.animT >= 1) this.state = 'open';
        break;
      case 'closing':
        this.animT = Math.min(1, this.animT + dtSeconds / CLOSE_SECONDS);
        this.root.scaling.setAll(Math.max(0.001, 1 - this.animT));
        if (this.animT >= 1) {
          this.state = 'closed';
          this.frame = null;
          this.root.setEnabled(false);
          this.surfaceMaterial.setFloat('linked', 0);
        }
        break;
      default:
        break;
    }
    if (this.state === 'closed') return;

    const linkedFrame = linked?.portalFrame ?? null;
    const linkedRTT = linked?.renderTarget ?? null;
    const showThrough = linkedFrame !== null && linkedRTT !== null && this.state !== 'closing';
    this.surfaceMaterial.setFloat('linked', showThrough ? 1 : 0);
    if (showThrough && this.assignedRTT !== linkedRTT) {
      this.surfaceMaterial.setTexture('rttSampler', linkedRTT);
      this.assignedRTT = linkedRTT;
    }
    if (!showThrough || !this.frame || !linkedFrame) return;

    // Virtual camera = main camera mapped through the pair (this → linked).
    portalPairTransformToRef(this.frame, linkedFrame, this.scratchPair);
    const mainWorld = mainCamera.getWorldMatrix();
    mainWorld.multiplyToRef(this.scratchPair, this.scratchWorld); // virtual WORLD matrix
    if (!this.virtualCamera.rotationQuaternion) this.virtualCamera.rotationQuaternion = Quaternion.Identity();
    this.scratchWorld.decompose(undefined, this.virtualCamera.rotationQuaternion, this.virtualCamera.position);
    this.virtualCamera.fov = fov;
    this.virtualCamera.minZ = mainCamera.minZ;
    this.virtualCamera.maxZ = mainCamera.maxZ;

    // Oblique near-plane on the EXIT portal's plane: clip everything behind
    // the exit wall. Plane normal points back toward the virtual camera
    // (-linked normal); if the exit wall ever leaks on screen, flip this sign.
    // View-space plane computed with scratch vectors (no Plane.transform alloc):
    // n_view = R_view · n_world; d_view = -(n_view · p_view).
    const viewMatrix = this.virtualCamera.getViewMatrix();
    this.scratchPlaneNormal.copyFrom(linkedFrame.normal).scaleInPlace(-1);
    Vector3.TransformNormalToRef(this.scratchPlaneNormal, viewMatrix, this.scratchPlaneNormal);
    Vector3.TransformCoordinatesToRef(linkedFrame.position, viewMatrix, this.scratchPlanePoint);
    const dView = -Vector3.Dot(this.scratchPlaneNormal, this.scratchPlanePoint);
    Matrix.PerspectiveFovLHToRef(
      fov,
      aspect,
      this.virtualCamera.minZ,
      this.virtualCamera.maxZ,
      this.scratchProj,
    );
    makeObliqueProjectionToRef(
      this.scratchProj,
      { x: this.scratchPlaneNormal.x, y: this.scratchPlaneNormal.y, z: this.scratchPlaneNormal.z, w: dView },
      this.scratchOblique,
    );
    this.virtualCamera.freezeProjectionMatrix(this.scratchOblique);

    const engine = this.scene.getEngine();
    this.surfaceMaterial.setVector2(
      'viewportSize',
      this.scratchViewport.set(engine.getRenderWidth(), engine.getRenderHeight()),
    );
  }

  dispose(): void {
    this.disposeRTT();
    this.surfaceMaterial.dispose();
    this.ring.material?.dispose();
    this.ring.dispose();
    this.surface.dispose();
    this.root.dispose();
    this.virtualCamera.dispose();
  }

  private createRTT(size: number): void {
    this.rtt = new RenderTargetTexture(`portal-${this.color}-rtt`, size, this.scene, true);
    this.rtt.activeCamera = this.virtualCamera;
    this.rtt.refreshRate = this.refreshRate;
    this.rtt.clearColor = this.scene.clearColor;
    this.scene.customRenderTargets.push(this.rtt);
    // Bind own RTT as the initial sampler so the shader never reads an
    // unbound texture while unlinked (linked=0 mixes it out anyway).
    this.surfaceMaterial.setTexture('rttSampler', this.rtt);
    this.assignedRTT = this.rtt;
    // Recursion gate: while THIS RTT renders, the partner's surface shows a
    // vortex instead of its own linked view when recursion is quality-gated off.
    this.rttObservers = [
      this.rtt.onBeforeRenderObservable.add(() => {
        if (!this.recursionEnabled) this.linkedPartner?.surfaceMaterial.setFloat('linked', 0);
      }),
      this.rtt.onAfterRenderObservable.add(() => {
        if (!this.recursionEnabled) this.linkedPartner?.restoreLinkedUniform();
      }),
    ];
  }

  /** Restore the surface's linked uniform after an RTT pass forced it off. */
  restoreLinkedUniform(): void {
    const showThrough = this.linkedPartner?.portalFrame != null && this.state !== 'closing' && this.state !== 'closed';
    this.surfaceMaterial.setFloat('linked', showThrough ? 1 : 0);
  }

  private disposeRTT(): void {
    if (!this.rtt) return;
    for (const observer of this.rttObservers) {
      this.rtt.onBeforeRenderObservable.remove(observer);
      this.rtt.onAfterRenderObservable.remove(observer);
    }
    this.rttObservers = [];
    const idx = this.scene.customRenderTargets.indexOf(this.rtt);
    if (idx >= 0) this.scene.customRenderTargets.splice(idx, 1);
    this.rtt.dispose();
    this.rtt = null;
  }
}

/** Overshoot ease for the opening pop (c1 = 1.70158, c3 = c1 + 1). */
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = t - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}
