/**
 * STUB — replaced by the audio subsystem agent.
 */
import { Vector3 } from '@babylonjs/core';
import type { IAudioSystem, IGameContext, MusicState } from '../core/types';

export class AudioSystem implements IAudioSystem {
  readonly name = 'audio';

  init(_ctx: IGameContext): void {}
  update(_dtSeconds: number): void {}
  play(_soundId: string, _options?: { volume?: number; pitch?: number }): void {}
  playAt(_soundId: string, _position: Vector3, _options?: { volume?: number; pitch?: number }): void {}
  startLoop(_soundId: string, _position?: Vector3): string {
    return 'stub-loop';
  }
  stopLoop(_loopId: string): void {}
  setMusicState(_state: MusicState): void {}
  applySettings(): void {}
  dispose(): void {}
}
