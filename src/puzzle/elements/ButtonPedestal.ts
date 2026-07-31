/**
 * puzzle/elements/ButtonPedestal.ts — standing pedestal button.
 */
import { Color3, MeshBuilder, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import { damp } from '../../core/math';
import { SOUND } from '../../core/soundIds';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { PuzzleContext } from '../types';

const PEDESTAL_HEIGHT = 1.1;
const BUTTON_RADIUS = 0.22;
const PRESS_DEPTH = 0.06;
const MOMENTARY_HOLD = 1.0;

export class ButtonPedestal extends BasePuzzleElement<{
  id: string;
  type: 'button-pedestal';
  position: { x: number; y: number; z: number };
  mode?: 'momentary' | 'latching';
}> {
  private readonly button: AbstractMesh;
  private readonly indicator: AbstractMesh;
  private readonly buttonMaterial: import('@babylonjs/core').StandardMaterial;
  private readonly mode: 'momentary' | 'latching';
  private latchingActive = false;
  private momentaryTimer = 0;
  private wasActive = false;

  constructor(
    id: string,
    spec: ButtonPedestal['spec'],
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);
    this.mode = spec.mode ?? 'latching';

    const base = MeshBuilder.CreateBox(
      `bp-${id}-base`,
      { width: 0.5, height: 0.4, depth: 0.5 },
      this.scene,
    );
    base.position.y = 0.2;
    base.material = this.ctx.systems.rendering.materials.darkMetal();
    this.track(base);

    const pillar = MeshBuilder.CreateBox(
      `bp-${id}-pillar`,
      { width: 0.28, height: PEDESTAL_HEIGHT, depth: 0.28 },
      this.scene,
    );
    pillar.position.y = 0.4 + PEDESTAL_HEIGHT / 2;
    pillar.material = this.ctx.systems.rendering.materials.trimMetal();
    this.track(pillar);

    this.button = MeshBuilder.CreateSphere(
      `bp-${id}-button`,
      { diameter: BUTTON_RADIUS * 2, segments: 16 },
      this.scene,
    );
    this.button.position.y = 0.4 + PEDESTAL_HEIGHT + 0.05;
    this.buttonMaterial = this.ctx.systems.rendering.materials.emissive(new Color3(1, 0.45, 0.08)) as import('@babylonjs/core').StandardMaterial;
    this.button.material = this.buttonMaterial;
    this.button.metadata = { ...this.button.metadata, interactableId: id, interactPrompt: 'Press' };
    this.track(this.button);

    this.indicator = MeshBuilder.CreateBox(
      `bp-${id}-indicator`,
      { width: 0.05, height: 0.05, depth: 0.06 },
      this.scene,
    );
    this.indicator.position.set(0, 0.4 + PEDESTAL_HEIGHT * 0.55, 0.16);
    this.indicator.material = materials.orangeEmissive;
    this.track(this.indicator);

    this.on('player:interacted', ({ targetId }) => {
      if (targetId !== this.id) return;
      this.ctx.systems.audio.play(SOUND.buttonPress);
      if (this.mode === 'latching') {
        this.latchingActive = !this.latchingActive;
      } else {
        this.momentaryTimer = MOMENTARY_HOLD;
      }
    });

    // Solid stand: without a collider the player walked straight through the
    // pedestal. The interactableId lives on the COLLIDER's proxy mesh: the
    // interact scan is a physics raycast, and the button sphere has no body —
    // without this the button was unpressable.
    const collider = this.ctx.systems.physics.createStaticBox({
      id: `bp-${id}-collider`,
      // Covers base + pillar; the button sphere pokes out above (stays
      // visible). Aiming at the sphere sends the ray through it (bodyless)
      // into the collider behind — the prompt still appears.
      size: new Vector3(0.4, 0.4 + PEDESTAL_HEIGHT, 0.4),
      position: this.node.position.clone().add(new Vector3(0, (0.4 + PEDESTAL_HEIGHT) / 2, 0)),
    });
    this.trackBody(collider);
    const proxy = this.ctx.systems.physics.getMeshForBody(collider);
    if (proxy) proxy.metadata = { interactableId: id, interactPrompt: '[E] Press' };
  }

  update(dtSeconds: number): void {
    if (this.mode === 'momentary' && this.momentaryTimer > 0) {
      this.momentaryTimer -= dtSeconds;
      if (this.momentaryTimer < 0) this.momentaryTimer = 0;
    }

    const active = this.mode === 'latching' ? this.latchingActive : this.momentaryTimer > 0;
    if (active && !this.wasActive) {
      this.emitActivated();
    } else if (!active && this.wasActive) {
      this.emitDeactivated();
      this.ctx.systems.audio.play(SOUND.buttonRelease);
    }
    this.wasActive = active;

    const targetDepth = active ? -PRESS_DEPTH : 0;
    const buttonY = 0.4 + PEDESTAL_HEIGHT + 0.05 + targetDepth;
    this.button.position.y = damp(this.button.position.y, buttonY, 18, dtSeconds);

    this.indicator.material = active ? this.materials.cyanEmissive : this.materials.orangeEmissive;
    this.buttonMaterial.emissiveColor = active
      ? this.materials.cyanEmissive.emissiveColor
      : this.materials.orangeEmissive.emissiveColor;
  }
}
