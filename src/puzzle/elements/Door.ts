/**
 * puzzle/elements/Door.ts — sliding Aperture aperture door.
 */
import { MeshBuilder, Vector3 } from '@babylonjs/core';
import type { AbstractMesh } from '@babylonjs/core';
import type { PhysicsBodyHandle } from '../../core/types';
import { CONFIG } from '../../core/Config';
import { damp } from '../../core/math';
import type { PuzzleElementSpec } from '../../core/types';
import { SOUND } from '../../core/soundIds';
import { BasePuzzleElement } from '../PuzzleElement';
import { PuzzleMaterials } from '../materials';
import type { PuzzleContext } from '../types';
import { withToRef } from '../physicsToRef';

const OBSTRUCTION_CHECK_RADIUS = 0.7;
const OBSTRUCTION_HEIGHT = 1.1;

type DoorSpec = Extract<PuzzleElementSpec, { type: 'door' }>;

export class Door extends BasePuzzleElement<DoorSpec> {
  private readonly orientation: 'x' | 'z';
  private readonly leftPanel: AbstractMesh;
  private readonly rightPanel: AbstractMesh;
  private readonly indicator: AbstractMesh;
  private readonly startsOpen: boolean;
  private currentOpen = 0; // 0 closed, 1 open
  private targetOpen: number;
  private blockerBody: PhysicsBodyHandle | null = null;
  private soundQueued: 'open' | 'close' | null = null;
  private readonly blockerPos = Vector3.Zero();

  constructor(
    id: string,
    spec: DoorSpec,
    context: PuzzleContext,
    materials: PuzzleMaterials,
  ) {
    super(id, spec, context, materials);
    this.orientation = spec.orientation;
    this.startsOpen = spec.startsOpen ?? false;
    this.targetOpen = this.startsOpen ? 1 : 0;

    const { width, height, thickness } = CONFIG.puzzle.doorSize;

    // Frame = two posts + a lintel. A single solid box here filled the entire
    // opening, so an "open" door still read (and screenshotted) as a wall.
    const frameMaterial = this.ctx.systems.rendering.materials.trimMetal();
    const postW = 0.08;
    for (const side of [-1, 1]) {
      const post = MeshBuilder.CreateBox(
        `door-${id}-frame-${side < 0 ? 'left' : 'right'}`,
        { width: postW, height: height + 0.08, depth: thickness + 0.08 },
        this.scene,
      );
      post.position.set(side * (width / 2 + postW / 2), height / 2, 0);
      post.material = frameMaterial;
      this.track(post);
    }
    const lintel = MeshBuilder.CreateBox(
      `door-${id}-frame-top`,
      { width: width + postW * 2, height: 0.08, depth: thickness + 0.08 },
      this.scene,
    );
    lintel.position.set(0, height + 0.04, 0);
    lintel.material = frameMaterial;
    this.track(lintel);

    const panelW = width / 2 - 0.02;
    const panelH = height - 0.04;
    const panelD = thickness;

    this.leftPanel = MeshBuilder.CreateBox(
      `door-${id}-left`,
      { width: panelW, height: panelH, depth: panelD },
      this.scene,
    );
    this.leftPanel.position.y = height / 2;
    this.leftPanel.material = this.ctx.systems.rendering.materials.wallPanel(false);
    this.track(this.leftPanel);

    this.rightPanel = MeshBuilder.CreateBox(
      `door-${id}-right`,
      { width: panelW, height: panelH, depth: panelD },
      this.scene,
    );
    this.rightPanel.position.y = height / 2;
    this.rightPanel.material = this.ctx.systems.rendering.materials.wallPanel(false);
    this.track(this.rightPanel);

    this.indicator = MeshBuilder.CreateBox(
      `door-${id}-indicator`,
      { width: width * 0.9, height: 0.04, depth: 0.02 },
      this.scene,
    );
    this.indicator.position.set(0, height - 0.12, thickness / 2 + 0.02);
    this.indicator.material = materials.orangeEmissive;
    this.track(this.indicator);

    this.updatePanelPositions(0);
    if (!this.startsOpen) {
      this.buildBlocker();
    }
  }

  onLinkState(active: boolean): void {
    const desired = active ? 1 : 0;
    if (this.targetOpen === desired) return;
    this.targetOpen = desired;
    this.soundQueued = desired === 1 ? 'open' : 'close';
  }

  update(dtSeconds: number): void {
    if (this.targetOpen === 0 && !this.blockerBody) {
      const blocked = this.isObstructed();
      if (blocked) {
        this.targetOpen = 1;
        this.soundQueued = 'open';
      }
    }

    const previousOpen = this.currentOpen;
    this.currentOpen = damp(this.currentOpen, this.targetOpen, 4.5, dtSeconds);
    this.updatePanelPositions(this.currentOpen);

    if (previousOpen < 0.5 && this.currentOpen >= 0.5 && this.soundQueued === 'open') {
      this.ctx.systems.audio.playAt(SOUND.doorOpen, this.node.position);
      this.soundQueued = null;
    }
    if (previousOpen > 0.5 && this.currentOpen <= 0.5 && this.soundQueued === 'close') {
      this.ctx.systems.audio.playAt(SOUND.doorClose, this.node.position);
      this.soundQueued = null;
    }

    if (this.currentOpen > 0.05 && this.blockerBody) {
      this.clearBlocker();
    } else if (this.currentOpen <= 0.05 && !this.blockerBody) {
      this.buildBlocker();
    }

    this.indicator.material = this.currentOpen > 0.5 ? this.materials.cyanEmissive : this.materials.orangeEmissive;
  }

  private updatePanelPositions(openRatio: number): void {
    // Closed: panels meet at the doorway center (±panelW/2). Open: each panel
    // slides its full width into the divider wall (pocket-door) so the doorway
    // clears completely. (The old 0→0.72 travel stacked both panels at x=0
    // when closed and left a 0.76m slit when "open".)
    const panelW = CONFIG.puzzle.doorSize.width / 2 - 0.02;
    const x = panelW / 2 + openRatio * panelW;
    if (this.orientation === 'x') {
      this.leftPanel.position.x = -x;
      this.rightPanel.position.x = x;
    } else {
      this.leftPanel.position.z = -x;
      this.rightPanel.position.z = x;
    }
  }

  /** No-allocation obstruction check against the door volume. */
  private isObstructed(): boolean {
    const cx = this.node.position.x;
    const cy = this.node.position.y + CONFIG.puzzle.doorSize.height / 2;
    const cz = this.node.position.z;

    const player = this.ctx.systems.player.position;
    const dx = player.x - cx;
    const dy = player.y - cy;
    const dz = player.z - cz;
    if (Math.hypot(dx, dz) < OBSTRUCTION_CHECK_RADIUS && Math.abs(dy) < OBSTRUCTION_HEIGHT) {
      return true;
    }

    const physics = withToRef(this.ctx.systems.physics);
    for (const t of physics.getTeleportables()) {
      physics.getBodyPositionToRef(t.handle, this.blockerPos);
      const bx = this.blockerPos.x - cx;
      const by = this.blockerPos.y - cy;
      const bz = this.blockerPos.z - cz;
      if (Math.hypot(bx, bz) < OBSTRUCTION_CHECK_RADIUS && Math.abs(by) < OBSTRUCTION_HEIGHT) {
        return true;
      }
    }
    return false;
  }

  /** Single, full-width blocker so there is no gap when closed. */
  private buildBlocker(): void {
    if (this.blockerBody) return;
    const { width, height, thickness } = CONFIG.puzzle.doorSize;
    this.blockerPos.copyFrom(this.node.position);
    this.blockerPos.y += height / 2;
    this.blockerBody = this.ctx.systems.physics.createStaticBox({
      id: `door-${this.id}-blocker`,
      size: new Vector3(width, height, thickness),
      position: this.blockerPos,
    });
  }

  private clearBlocker(): void {
    if (!this.blockerBody) return;
    this.ctx.systems.physics.removeBody(this.blockerBody);
    this.blockerBody = null;
  }

  protected beforeDispose(): void {
    this.clearBlocker();
  }
}
