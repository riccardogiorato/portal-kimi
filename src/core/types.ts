/**
 * core/types.ts — Shared contracts for every subsystem.
 *
 * This file is the single source of truth for cross-system communication.
 * Implementations live in their subsystem directories; the interfaces they
 * expose to other systems are defined HERE so `core` never imports from a
 * subsystem (no circular dependencies).
 *
 * OWNERSHIP: core (integration). Subsystem agents must NOT edit this file;
 * if a contract is genuinely insufficient, expose the extra capability on
 * your concrete class and note it in your agent report.
 */
import type { AbstractMesh, Color3, Engine, Material, Quaternion, Scene, UniversalCamera, Vector3 } from '@babylonjs/core';
import type { EventBus } from './EventBus';
import type { GameConfig } from './Config';
import type { SettingsManager } from './SettingsManager';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Plain serializable vector for level data and saves. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type PortalColor = 'blue' | 'orange';

export type GameState =
  | 'boot'
  | 'menu'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'dead'
  | 'chamberComplete';

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export type MusicState = 'off' | 'menu' | 'chamber-calm' | 'chamber-tense' | 'chamber-complete';

export type ChamberMood = 'clean' | 'damaged' | 'dark';

// ---------------------------------------------------------------------------
// Settings & saves
// ---------------------------------------------------------------------------

export interface GameSettings {
  masterVolume: number; // 0..1
  musicVolume: number; // 0..1
  sfxVolume: number; // 0..1
  mouseSensitivity: number; // multiplier, 0.1..10
  invertY: boolean;
  fovDegrees: number; // 60..120
  quality: QualityLevel;
  subtitles: boolean;
}

export interface SaveData {
  version: 1;
  unlockedLevelIndex: number;
  completedLevelIds: string[];
  bestTimeMsByLevel: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Level data schema (authored in src/levels/chambers/*)
// ---------------------------------------------------------------------------

export interface SpawnTransform {
  position: Vec3;
  yawDegrees: number;
}

export type WallId = 'north' | 'south' | 'east' | 'west' | 'floor' | 'ceiling';

/**
 * Overrides the portalability of a rectangular run of wall panels.
 * Coordinates are in panel units (see Config.levels.panelSize), origin at the
 * bottom-left of the wall as seen from inside the chamber.
 */
export interface SurfaceOverride {
  wall: WallId;
  col: number;
  row: number;
  cols: number;
  rows: number;
  portalable: boolean;
}

/** Activation wiring: when the source element activates, targets react. */
export interface ElementLink {
  targetId: string;
  /** When true, the target receives the inverted signal. */
  invert?: boolean;
}

interface ElementBase {
  id: string;
  position: Vec3;
  links?: ElementLink[];
}

export type PuzzleElementSpec =
  | (ElementBase & {
      type: 'button-floor';
      mode?: 'momentary' | 'latching';
      /** Seconds a momentary button stays pressed after release; 0 = until unpressed. */
      holdSeconds?: number;
    })
  | (ElementBase & { type: 'button-pedestal'; mode?: 'momentary' | 'latching' })
  | (ElementBase & { type: 'cube'; kind?: 'weighted' })
  | (ElementBase & { type: 'cube-dispenser'; initialDrop?: boolean })
  | (ElementBase & {
      type: 'door';
      orientation: 'x' | 'z';
      /** 'all' = every incoming link active; 'any' = at least one. Default 'all'. */
      require?: 'all' | 'any';
      startsOpen?: boolean;
    })
  | (ElementBase & { type: 'laser-emitter'; direction: Vec3 })
  | (ElementBase & { type: 'laser-receiver' })
  | (ElementBase & { type: 'laser-relay' })
  | (ElementBase & { type: 'faith-plate'; target: Vec3; power?: number })
  | (ElementBase & {
      type: 'funnel';
      direction: Vec3;
      length: number;
      polarity?: 'push' | 'pull';
      startsActive?: boolean;
    })
  | (ElementBase & { type: 'light-bridge'; direction: Vec3; length: number; startsActive?: boolean })
  | (ElementBase & { type: 'platform'; path: Vec3[]; speed?: number; startsActive?: boolean })
  | (ElementBase & { type: 'glass'; size: { width: number; height: number }; orientation: 'x' | 'z' })
  | (ElementBase & { type: 'goo'; size: { width: number; depth: number } })
  | (ElementBase & { type: 'exit-elevator' });

export interface ChamberDefinition {
  id: string;
  /** Displayed in the loading screen, e.g. "Test Chamber 01". */
  name: string;
  /** Flavor line under the name. */
  tagline?: string;
  /** Interior dimensions in meters. */
  size: { width: number; height: number; depth: number };
  spawn: SpawnTransform;
  elements: PuzzleElementSpec[];
  surfaceOverrides?: SurfaceOverride[];
  mood?: ChamberMood;
  /** Subtitle/voiceover lines played on chamber entry, in order. */
  introLines?: string[];
  /** Hint shown after the player idles too long. */
  hint?: string;
}

// ---------------------------------------------------------------------------
// Event map — the nervous system of the game. Emit, don't call, whenever the
// coupling is one-to-many or crosses more than one boundary.
// ---------------------------------------------------------------------------

export interface GameEventMap {
  'game:stateChanged': { from: GameState; to: GameState };
  'game:pauseRequested': Record<string, never>;
  'game:resumeRequested': Record<string, never>;
  'game:quitToMenu': Record<string, never>;

  'level:loadRequested': { levelIndex: number };
  'level:loading': { levelIndex: number; definition: ChamberDefinition };
  'level:loaded': { levelIndex: number; definition: ChamberDefinition };
  'level:completed': { levelIndex: number; levelId: string; timeMs: number };
  'level:restartRequested': Record<string, never>;

  'player:spawned': { position: Vec3 };
  'player:teleported': { color: PortalColor };
  'player:died': { cause: 'goo' | 'crush' | 'fall' | 'laser' };
  'player:respawned': Record<string, never>;
  'player:landed': { impactSpeed: number };
  'player:step': { speed: number };
  /** E-raycast hit a mesh whose metadata.interactableId is set. */
  'player:interacted': { targetId: string };

  'portal:fired': { color: PortalColor };
  'portal:placed': { color: PortalColor; position: Vector3; normal: Vector3 };
  'portal:placementFailed': { color: PortalColor; reason: string };
  'portal:cleared': { color: PortalColor };

  'object:grabbed': { objectId: string };
  'object:released': { objectId: string; thrown: boolean };
  'object:teleported': { objectId: string; color: PortalColor };
  'object:fizzled': { objectId: string; reason: 'portal-closed' | 'dispenser' };

  'element:activated': { elementId: string };
  'element:deactivated': { elementId: string };

  'ui:subtitle': { text: string; durationSeconds?: number; speaker?: string };
  'ui:hint': { text: string };

  'settings:changed': { settings: GameSettings };
}

// ---------------------------------------------------------------------------
// System lifecycle
// ---------------------------------------------------------------------------

export interface ISystem {
  readonly name: string;
  init(ctx: IGameContext): void | Promise<void>;
  update(dtSeconds: number): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Subsystem contracts (implemented in subsystem directories)
// ---------------------------------------------------------------------------

export interface IPlayerSystem extends ISystem {
  readonly camera: UniversalCamera;
  readonly position: Vector3;
  readonly velocity: Vector3;
  readonly isGrounded: boolean;
  /** Apply a portal-pair transform to the player (position, rotation, velocity). */
  teleportThroughPortal(worldTransform: Matrix4Like, linkedNormal: Vector3): void;
  /** Instantly move the player to a spawn point and zero velocity. */
  placeAt(spawn: SpawnTransform): void;
  /** Enable/disable simulation + input (menus, death, cutscene). */
  setActive(active: boolean): void;
  /** Set the player's velocity outright (faith plates, flings). */
  launch(velocity: Vector3): void;
  /** Accumulate an external velocity influence for the next frame (funnels). */
  addExternalVelocity(velocity: Vector3): void;
}

/** Minimal structural type so core doesn't depend on Babylon's Matrix in types. */
export interface Matrix4Like {
  m: Float32Array | number[];
}

export interface IPortalHandle {
  readonly color: PortalColor;
  readonly isPlaced: boolean;
  readonly position: Vector3;
  readonly normal: Vector3;
}

export interface IPortalSystem extends ISystem {
  fire(color: PortalColor): void;
  getPortal(color: PortalColor): IPortalHandle | null;
  /** True when both portals are placed and linked. */
  readonly isLinked: boolean;
  clearAll(): void;
  /** Can a portal currently be placed on this mesh? */
  isPortalable(mesh: AbstractMesh): boolean;
}

/** Opaque identifier for a physics body managed by the physics system. */
export type PhysicsBodyHandle = string;

export interface StaticBoxOptions {
  id: string;
  size: Vector3;
  position: Vector3;
  rotation?: Quaternion;
  friction?: number;
}

export interface BoxBodyOptions {
  id: string;
  size: Vector3;
  position: Vector3;
  rotation?: Quaternion;
  mass: number;
  linearDamping?: number;
  angularDamping?: number;
  restitution?: number;
  friction?: number;
  /** Attach a visible mesh to this body (returned by getMeshForBody). */
  mesh?: AbstractMesh;
}

export interface TeleportableInfo {
  handle: PhysicsBodyHandle;
  id: string;
  /** Bounding radius for portal crossing checks. */
  radius: number;
}

export interface IPhysicsSystem extends ISystem {
  /** First hit along the ray, or null. Used by portals, interaction, lasers. */
  raycast(origin: Vector3, direction: Vector3, maxDistance: number): PhysicsHit | null;
  setGravity(gravity: Vector3): void;

  createStaticBox(options: StaticBoxOptions): PhysicsBodyHandle;
  createBoxBody(options: BoxBodyOptions): PhysicsBodyHandle;
  removeBody(handle: PhysicsBodyHandle): void;

  applyImpulse(handle: PhysicsBodyHandle, impulse: Vector3): void;
  setLinearVelocity(handle: PhysicsBodyHandle, velocity: Vector3): void;
  getLinearVelocity(handle: PhysicsBodyHandle): Vector3;
  getBodyPosition(handle: PhysicsBodyHandle): Vector3;
  getBodyQuaternion(handle: PhysicsBodyHandle): Quaternion;
  /** Instant move with no physics interpolation (portal travel). */
  teleportBody(handle: PhysicsBodyHandle, position: Vector3, rotation: Quaternion): void;
  getMeshForBody(handle: PhysicsBodyHandle): AbstractMesh | null;

  /** Bodies the portal system scans every frame for portal crossings. */
  registerTeleportable(handle: PhysicsBodyHandle, info: { id: string; radius: number }): void;
  unregisterTeleportable(handle: PhysicsBodyHandle): void;
  getTeleportables(): readonly TeleportableInfo[];
}

export interface PhysicsHit {
  point: Vector3;
  normal: Vector3;
  distance: number;
  mesh: AbstractMesh | null;
  bodyHandle: PhysicsBodyHandle | null;
}

export interface IPuzzleSystem extends ISystem {
  /** Build all elements for a chamber under the given parent node. */
  buildChamber(definition: ChamberDefinition): void;
  /** Tear down all chamber elements. */
  clearChamber(): void;
}

/**
 * Shared procedural PBR materials (the chamber visual identity). Implemented
 * by the rendering system; consumed by levels (chamber panels) and puzzle
 * (element housings). Materials are shared instances — do not mutate them.
 */
export interface IMaterialLibrary {
  /** White (portalable) or dark gunmetal (non-portalable) wall panel. */
  wallPanel(portalable: boolean): Material;
  floorPanel(): Material;
  ceilingPanel(): Material;
  /** Brushed metal trim/frames. */
  trimMetal(): Material;
  darkMetal(): Material;
  glass(): Material;
  /** Self-illuminated strip/fixture material. */
  emissive(color: Color3, intensity?: number): Material;
  cubeShell(): Material;
  buttonHousing(): Material;
}

export interface IRenderingSystem extends ISystem {
  readonly materials: IMaterialLibrary;
  applyQuality(level: QualityLevel): void;
  setMood(mood: ChamberMood): void;
  /** Screen shake impulse, e.g. on landing or nearby explosion. */
  shake(intensity: number): void;
}

export interface IAudioSystem extends ISystem {
  play(soundId: string, options?: { volume?: number; pitch?: number }): void;
  playAt(soundId: string, position: Vector3, options?: { volume?: number; pitch?: number }): void;
  /** Start a looping sound (laser hum, funnel, bridge). Returns a loop id. */
  startLoop(soundId: string, position?: Vector3): string;
  stopLoop(loopId: string): void;
  setMusicState(state: MusicState): void;
  /** Re-read volumes from settings (after settings:changed). */
  applySettings(): void;
}

export interface IUISystem extends ISystem {
  showMainMenu(): void;
  showPauseMenu(): void;
  showHUD(): void;
  hideAll(): void;
  setPortalIndicators(blue: boolean, orange: boolean): void;
  showSubtitle(text: string, durationSeconds?: number, speaker?: string): void;
  showHint(text: string): void;
  showLoading(definition: ChamberDefinition): void;
  fadeToBlack(durationSeconds: number): Promise<void>;
  fadeFromBlack(durationSeconds: number): Promise<void>;
}

export interface ILevelSystem extends ISystem {
  loadLevel(levelIndex: number): Promise<void>;
  restartLevel(): Promise<void>;
  readonly currentLevelIndex: number;
  readonly levelCount: number;
  /** Highest chamber index the player may start from (save-driven). */
  readonly unlockedLevelIndex: number;
  /** Chamber ids/names for menus, in campaign order. */
  getLevelList(): { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Game context — passed to every system at init.
// ---------------------------------------------------------------------------

export interface IGameContext {
  readonly engine: Engine;
  readonly scene: Scene;
  readonly canvas: HTMLCanvasElement;
  readonly events: EventBus;
  readonly config: GameConfig;
  readonly settings: SettingsManager;
  readonly systems: {
    player: IPlayerSystem;
    physics: IPhysicsSystem;
    portals: IPortalSystem;
    puzzle: IPuzzleSystem;
    rendering: IRenderingSystem;
    audio: IAudioSystem;
    ui: IUISystem;
    levels: ILevelSystem;
  };
}
