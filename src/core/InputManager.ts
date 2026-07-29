/**
 * core/InputManager.ts — Single owner of raw input. Systems poll actions or
 * subscribe to presses; nobody else attaches DOM listeners. Pointer lock is
 * requested/released here and nowhere else.
 */
import type { EventBus } from './EventBus';

export type InputAction =
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'jump'
  | 'crouch'
  | 'sprint'
  | 'interact'
  | 'fireBlue'
  | 'fireOrange'
  | 'restartLevel';

const KEY_BINDINGS: Record<string, InputAction> = {
  KeyW: 'moveForward',
  KeyS: 'moveBackward',
  KeyA: 'moveLeft',
  KeyD: 'moveRight',
  Space: 'jump',
  KeyC: 'crouch',
  ControlLeft: 'crouch',
  ShiftLeft: 'sprint',
  KeyE: 'interact',
  KeyR: 'restartLevel',
};

export class InputManager {
  private readonly held = new Set<InputAction>();
  private readonly pressHandlers = new Map<InputAction, Set<() => void>>();
  private mouseDx = 0;
  private mouseDy = 0;
  private listening = false;

  /** True while the pointer is locked to the canvas. */
  pointerLocked = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly events: EventBus,
  ) {}

  attach(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    // Suppress the context menu so RMB can fire the orange portal.
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  detach(): void {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.held.clear();
  }

  isHeld(action: InputAction): boolean {
    return this.held.has(action);
  }

  /** Subscribe to the initial press edge of an action. Returns unsubscribe. */
  onPress(action: InputAction, handler: () => void): () => void {
    let set = this.pressHandlers.get(action);
    if (!set) {
      set = new Set();
      this.pressHandlers.set(action, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  /** Consume accumulated mouse deltas (radians-ready pixels) for this frame. */
  consumeMouseDelta(): { dx: number; dy: number } {
    const delta = { dx: this.mouseDx, dy: this.mouseDy };
    this.mouseDx = 0;
    this.mouseDy = 0;
    return delta;
  }

  async requestPointerLock(): Promise<void> {
    if (this.pointerLocked) return;
    try {
      // `unadjustedMovement` kills OS mouse acceleration where supported.
      await (this.canvas.requestPointerLock as (options?: { unadjustedMovement?: boolean }) => Promise<void>).call(
        this.canvas,
        { unadjustedMovement: true },
      );
    } catch {
      try {
        this.canvas.requestPointerLock();
      } catch {
        // User gesture required; the next click will retry.
      }
    }
  }

  releasePointerLock(): void {
    if (this.pointerLocked) document.exitPointerLock();
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const action = KEY_BINDINGS[event.code];
    if (!action) return;
    if (event.repeat) return;
    this.held.add(action);
    const handlers = this.pressHandlers.get(action);
    if (handlers) for (const handler of [...handlers]) handler();
    if (this.pointerLocked) event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    const action = KEY_BINDINGS[event.code];
    if (action) this.held.delete(action);
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (!this.pointerLocked) return;
    const action: InputAction | null = event.button === 0 ? 'fireBlue' : event.button === 2 ? 'fireOrange' : null;
    if (!action) return;
    this.held.add(action);
    const handlers = this.pressHandlers.get(action);
    if (handlers) for (const handler of [...handlers]) handler();
    event.preventDefault();
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (!this.pointerLocked) return;
    this.mouseDx += event.movementX;
    this.mouseDy += event.movementY;
  };

  private onPointerLockChange = (): void => {
    const locked = document.pointerLockElement === this.canvas;
    const wasLocked = this.pointerLocked;
    this.pointerLocked = locked;
    if (wasLocked && !locked) {
      // Esc pressed or lock lost: drop all held inputs and ask the game to pause.
      this.held.clear();
      this.mouseDx = 0;
      this.mouseDy = 0;
      this.events.emit('game:pauseRequested', {});
    }
  };

  private onContextMenu = (event: Event): void => event.preventDefault();

  private onBlur = (): void => {
    this.held.clear();
  };
}
