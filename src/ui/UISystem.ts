/**
 * STUB — replaced by the UI subsystem agent.
 * Minimal DOM menu so the game is bootable end-to-end during integration.
 */
import type { ChamberDefinition, IGameContext, IUISystem } from '../core/types';

export class UISystem implements IUISystem {
  readonly name = 'ui';
  private ctx!: IGameContext;
  private root?: HTMLDivElement;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;inset:0;display:none;align-items:center;justify-content:center;' +
      'flex-direction:column;gap:16px;color:#cfe3f5;font-family:system-ui;background:rgba(5,8,12,0.85);z-index:100';
    document.body.appendChild(this.root);
  }

  update(_dtSeconds: number): void {}

  showMainMenu(): void {
    if (!this.root) return;
    this.root.style.display = 'flex';
    this.root.innerHTML = '';
    const title = document.createElement('h1');
    title.textContent = 'PORTAL';
    title.style.cssText = 'letter-spacing:0.5em;font-weight:200;margin:0';
    const button = document.createElement('button');
    button.textContent = 'BEGIN TESTING';
    button.style.cssText =
      'padding:12px 32px;background:transparent;color:#6ec1ff;border:1px solid #6ec1ff;' +
      'letter-spacing:0.3em;cursor:pointer;font-size:14px';
    button.onclick = () => this.ctx.events.emit('level:loadRequested', { levelIndex: 0 });
    this.root.append(title, button);
  }

  showPauseMenu(): void {
    this.showMainMenu();
  }
  showHUD(): void {
    if (this.root) this.root.style.display = 'none';
  }
  hideAll(): void {
    if (this.root) this.root.style.display = 'none';
  }
  setPortalIndicators(_blue: boolean, _orange: boolean): void {}
  showSubtitle(_text: string, _durationSeconds?: number, _speaker?: string): void {}
  showHint(_text: string): void {}
  showLoading(_definition: ChamberDefinition): void {}
  fadeToBlack(_durationSeconds: number): Promise<void> {
    return Promise.resolve();
  }
  fadeFromBlack(_durationSeconds: number): Promise<void> {
    return Promise.resolve();
  }
  dispose(): void {
    this.root?.remove();
  }
}
