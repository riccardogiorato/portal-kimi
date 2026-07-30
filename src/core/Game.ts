/**
 * core/Game.ts — Top-level orchestrator. Owns the engine, scene, state
 * machine and system lifecycle. Subsystems never talk to each other
 * directly; they go through the EventBus or the typed contracts in
 * core/types.ts.
 *
 * OWNERSHIP: core (integration). Subsystem agents must not edit this file.
 */
import { Engine, Scene, Vector3 } from '@babylonjs/core';
import { CONFIG } from './Config';
import { EventBus } from './EventBus';
import { InputManager } from './InputManager';
import { SaveSystem } from './SaveSystem';
import { SettingsManager } from './SettingsManager';
import type { GameState, IGameContext } from './types';

import { AudioSystem } from '../audio/AudioSystem';
import { LevelSystem } from '../levels/LevelSystem';
import { PhysicsSystem } from '../physics/PhysicsSystem';
import { PlayerSystem } from '../player/PlayerSystem';
import { PortalSystem } from '../portals/PortalSystem';
import { PuzzleSystem } from '../puzzle/PuzzleSystem';
import { RenderingSystem } from '../rendering/RenderingSystem';
import { UISystem } from '../ui/UISystem';

const MAX_DT_SECONDS = 1 / 20; // clamp huge frames (tab switch) to avoid tunneling

export class Game {
  private readonly canvas: HTMLCanvasElement;
  private readonly events = new EventBus();
  private readonly settings: SettingsManager;
  private readonly save = new SaveSystem();
  private input!: InputManager;

  private engine!: Engine;
  private scene!: Scene;
  private ctx!: IGameContext;

  private state: GameState = 'boot';
  private levelStartTimeMs = 0;
  private disposed = false;
  private consecutiveRenderErrors = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.settings = new SettingsManager(this.events);
  }

  get currentState(): GameState {
    return this.state;
  }

  async init(): Promise<void> {
    this.engine = new Engine(this.canvas, true, {
      stencil: true,
      adaptToDeviceRatio: true,
      antialias: false, // AA is owned by the rendering pipeline (MSAA on the RT + FXAA)
      powerPreference: 'high-performance',
    });
    this.scene = new Scene(this.engine);
    // CONFIG.physics.gravityY is already signed (-19.6): game-tuned ~2x earth gravity.
    this.scene.gravity = new Vector3(0, CONFIG.physics.gravityY, 0);

    this.input = new InputManager(this.canvas, this.events);
    this.input.attach();

    // Systems are constructed here and nowhere else.
    const rendering = new RenderingSystem();
    const physics = new PhysicsSystem();
    const player = new PlayerSystem(this.input);
    const portals = new PortalSystem();
    const puzzle = new PuzzleSystem();
    const levels = new LevelSystem(this.save);
    const audio = new AudioSystem();
    const ui = new UISystem();

    this.ctx = {
      engine: this.engine,
      scene: this.scene,
      canvas: this.canvas,
      events: this.events,
      config: CONFIG,
      settings: this.settings,
      systems: { player, physics, portals, puzzle, rendering, audio, ui, levels },
    };

    // Init order matters: rendering (lights/materials) → physics → player
    // (camera) → portals (needs camera + physics) → puzzle → levels → audio → ui.
    await rendering.init(this.ctx);
    await physics.init(this.ctx);
    await player.init(this.ctx);
    await portals.init(this.ctx);
    await puzzle.init(this.ctx);
    await levels.init(this.ctx);
    await audio.init(this.ctx);
    await ui.init(this.ctx);

    this.wireStateTransitions();
    this.wirePointerLock();

    window.addEventListener('resize', this.onResize);

    this.engine.runRenderLoop(() => this.frame());

    this.transitionTo('menu');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener('resize', this.onResize);
    this.engine.stopRenderLoop();
    const { systems } = this.ctx;
    for (const system of Object.values(systems)) system.dispose();
    this.input.detach();
    this.events.clear();
    this.scene.dispose();
    this.engine.dispose();
  }

  // -------------------------------------------------------------------------
  // Frame loop
  // -------------------------------------------------------------------------

  private frame(): void {
    const dt = Math.min(this.engine.getDeltaTime() / 1000, MAX_DT_SECONDS);
    const { systems } = this.ctx;

    if (this.state === 'playing') {
      systems.player.update(dt);
      systems.portals.update(dt);
      systems.puzzle.update(dt);
      systems.levels.update(dt);
    }
    // Audio + UI + rendering run in every state (menus animate, music plays).
    systems.rendering.update(dt);
    systems.audio.update(dt);
    systems.ui.update(dt);

    try {
      this.scene.render();
      this.consecutiveRenderErrors = 0;
    } catch (error) {
      // Circuit breaker: an optional effect (SSAO's onApply is the known
      // case) can throw per-frame on unsupported drivers, aborting renders
      // and blacking out the canvas. Degrade gracefully instead of dying.
      this.consecutiveRenderErrors++;
      if (this.consecutiveRenderErrors === 1) {
        console.error('[game] render error — disabling SSAO:', error);
        (systems.rendering as RenderingSystem).disableSSAO();
      } else if (this.consecutiveRenderErrors === 3) {
        console.error('[game] render errors persist — disabling post effects:', error);
        (systems.rendering as RenderingSystem).disablePostEffects();
      } else if (this.consecutiveRenderErrors >= 6) {
        throw error; // genuine bug, not an optional effect — fail loud.
      }
    }
  }

  // -------------------------------------------------------------------------
  // State machine
  // -------------------------------------------------------------------------

  private transitionTo(next: GameState): void {
    if (this.state === next) return;
    const from = this.state;
    this.state = next;
    const { systems } = this.ctx;

    switch (next) {
      case 'menu':
        systems.player.setActive(false);
        systems.ui.showMainMenu();
        systems.audio.setMusicState('menu');
        this.input.releasePointerLock();
        break;
      case 'playing':
        systems.player.setActive(true);
        systems.ui.showHUD();
        void this.input.requestPointerLock();
        break;
      case 'paused':
        systems.player.setActive(false);
        systems.ui.showPauseMenu();
        this.input.releasePointerLock();
        break;
      case 'loading':
        systems.player.setActive(false);
        break;
      case 'dead':
        systems.player.setActive(false);
        break;
      case 'chamberComplete':
        systems.player.setActive(false);
        this.input.releasePointerLock();
        break;
      case 'boot':
        break;
    }

    this.events.emit('game:stateChanged', { from, to: next });
  }

  private wireStateTransitions(): void {
    this.events.on('game:pauseRequested', () => {
      if (this.state === 'playing') this.transitionTo('paused');
    });
    this.events.on('game:resumeRequested', () => {
      if (this.state === 'paused') this.transitionTo('playing');
    });
    this.events.on('game:quitToMenu', () => this.transitionTo('menu'));

    this.events.on('level:loadRequested', ({ levelIndex }) => {
      void this.loadLevel(levelIndex);
    });
    this.events.on('level:restartRequested', () => {
      if (this.state === 'playing' || this.state === 'paused' || this.state === 'dead') {
        void this.restartLevel();
      }
    });

    this.events.on('level:loaded', () => {
      this.levelStartTimeMs = performance.now();
      this.transitionTo('playing');
    });

    this.events.on('level:completed', ({ levelIndex, levelId }) => {
      const timeMs = performance.now() - this.levelStartTimeMs;
      this.save.recordCompletion(levelId, levelIndex, timeMs);
      this.transitionTo('chamberComplete');
      const nextIndex = levelIndex + 1;
      if (nextIndex < this.ctx.systems.levels.levelCount) {
        // Brief beat on the elevator, then the next chamber loads.
        setTimeout(() => void this.loadLevel(nextIndex), CONFIG.levels.elevatorRideSeconds * 1000);
      } else {
        // Campaign finished: back to menu (UI shows completion state).
        setTimeout(() => this.transitionTo('menu'), CONFIG.levels.elevatorRideSeconds * 1000);
      }
    });

    this.events.on('player:died', () => {
      if (this.state !== 'playing') return;
      this.transitionTo('dead');
      void (async () => {
        await this.ctx.systems.ui.fadeToBlack(CONFIG.levels.respawnFadeSeconds);
        await this.restartLevel();
        await this.ctx.systems.ui.fadeFromBlack(CONFIG.levels.respawnFadeSeconds);
      })();
    });
  }

  private wirePointerLock(): void {
    // Clicking the canvas while playing (e.g. after Alt-Tab) re-locks.
    this.canvas.addEventListener('click', () => {
      if (this.state === 'playing' && !this.input.pointerLocked) {
        void this.input.requestPointerLock();
      }
    });
  }

  private async loadLevel(levelIndex: number): Promise<void> {
    this.transitionTo('loading');
    await this.ctx.systems.levels.loadLevel(levelIndex);
    // 'level:loaded' → transitionTo('playing') happens in the handler above.
  }

  private async restartLevel(): Promise<void> {
    this.transitionTo('loading');
    await this.ctx.systems.levels.restartLevel();
  }

  private onResize = (): void => {
    this.engine.resize();
  };
}
