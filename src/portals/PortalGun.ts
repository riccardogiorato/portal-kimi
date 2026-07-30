/**
 * portals/PortalGun.ts — first-person portal device viewmodel.
 *
 * Procedural white-pronged device riding the camera: idle sway, walk bob,
 * recoil kick on fire, glowing core tinted by the last fired color. All
 * animation is damped sinusoid math on one transform — zero allocation.
 */
import { Color3, Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';
import { damp } from '../core/math';
import type { IGameContext, PortalColor } from '../core/types';

const BASE_OFFSET = new Vector3(0.27, -0.23, 0.5);
const RECOIL_KICK = 0.06;
const RECOIL_RECOVER_RATE = 9;
const SWAY_RATE = 0.9;
const BOB_RATE = 8.5;

export class PortalGun {
  private readonly root: TransformNode;
  private readonly core: Mesh;
  private readonly coreMaterial: StandardMaterial;
  private readonly unsubscribers: Array<() => void> = [];
  private time = 0;
  private recoil = 0;
  private tipColor = new Color3(0.7, 0.8, 0.9);
  private readonly scratchColor = Color3.Black();

  constructor(ctx: IGameContext) {
    const scene: Scene = ctx.scene;
    this.root = new TransformNode('portal-gun-root', scene);
    this.root.parent = ctx.systems.player.camera;
    this.root.position.copyFrom(BASE_OFFSET);

    const white = ctx.systems.rendering.materials.cubeShell();
    const dark = ctx.systems.rendering.materials.darkMetal();

    // Central body: squat rounded barrel.
    const body = MeshBuilder.CreateBox('gun-body', { width: 0.09, height: 0.11, depth: 0.3 }, scene);
    body.material = white;
    body.parent = this.root;

    // Rear grip block.
    const grip = MeshBuilder.CreateBox('gun-grip', { width: 0.07, height: 0.14, depth: 0.08 }, scene);
    grip.material = dark;
    grip.position.set(0, -0.1, -0.12);
    grip.rotation.x = 0.35;
    grip.parent = this.root;

    // Three forward prongs (the iconic claws).
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + Math.PI / 2;
      const prong = MeshBuilder.CreateCylinder(`gun-prong-${i}`, { height: 0.22, diameterTop: 0.012, diameterBottom: 0.02, tessellation: 10 }, scene);
      prong.material = white;
      prong.rotation.x = Math.PI / 2;
      prong.rotation.y = Math.cos(angle) * 0.16;
      prong.rotation.z = -Math.sin(angle) * 0.16;
      prong.position.set(Math.cos(angle) * 0.045, Math.sin(angle) * 0.045, 0.22);
      prong.parent = this.root;
    }

    // Glowing core between the prongs.
    this.coreMaterial = new StandardMaterial('gun-core-mat', scene);
    this.coreMaterial.emissiveColor = this.tipColor;
    this.coreMaterial.disableLighting = true;
    this.core = MeshBuilder.CreateSphere('gun-core', { diameter: 0.05, segments: 12 }, scene);
    this.core.material = this.coreMaterial;
    this.core.position.set(0, 0, 0.16);
    this.core.parent = this.root;

    // The gun stays on the default layer: it remains visible through portals
    // (you see your mirrored self holding it — Portal-authentic).

    this.unsubscribers.push(
      ctx.events.on('portal:fired', ({ color }) => this.onFired(color)),
    );
  }

  private onFired(color: PortalColor): void {
    this.recoil = 1;
    this.tipColor = color === 'blue' ? new Color3(0.12, 0.55, 1.0) : new Color3(1.0, 0.45, 0.08);
  }

  update(dtSeconds: number, playerSpeed: number, isGrounded: boolean): void {
    this.time += dtSeconds;
    this.recoil = Math.max(0, this.recoil - this.recoil * RECOIL_RECOVER_RATE * dtSeconds);

    // Idle sway: slow drifting figure-eight.
    const swayX = Math.sin(this.time * SWAY_RATE) * 0.0035;
    const swayY = Math.cos(this.time * SWAY_RATE * 1.7) * 0.0028;

    // Walk bob: amplitude scales with grounded speed.
    const speed01 = Math.min(1, playerSpeed / 7.2);
    const bobAmp = isGrounded ? speed01 * 0.008 : 0;
    const bobX = Math.sin(this.time * BOB_RATE * 0.5) * bobAmp;
    const bobY = -Math.abs(Math.sin(this.time * BOB_RATE)) * bobAmp * 1.2;

    const kick = this.recoil * RECOIL_KICK;
    this.root.position.set(
      BASE_OFFSET.x + swayX + bobX,
      BASE_OFFSET.y + swayY + bobY - kick * 0.4,
      BASE_OFFSET.z - kick,
    );
    this.root.rotation.set(kick * 1.6 + swayY * 2, swayX * 2, 0);

    // Core pulse: brighter right after firing, gentle breathing otherwise.
    const pulse = 1 + this.recoil * 2.5 + Math.sin(this.time * 2.2) * 0.15;
    this.scratchColor.copyFrom(this.tipColor).scaleInPlace(pulse);
    this.coreMaterial.emissiveColor.copyFrom(this.scratchColor);
    const coreScale = 1 + this.recoil * 0.6;
    this.core.scaling.setAll(damp(this.core.scaling.x, coreScale, 12, dtSeconds));
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    const meshes = this.root.getChildMeshes(false);
    for (const mesh of meshes) mesh.dispose();
    this.coreMaterial.dispose();
    this.root.dispose();
  }
}
