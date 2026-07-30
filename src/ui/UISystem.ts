import type {
  ChamberDefinition,
  GameEventMap,
  GameSettings,
  GameState,
  IGameContext,
  IUISystem,
} from '../core/types';
import { SubtitleQueue } from './SubtitleQueue';
import { buildSettingsPatch, clamp } from './SettingsBinding';

const ACCENT = '#6ec1ff';
const ACCENT_ORANGE = '#ff7a2e';
const TEXT = '#cfe3f5';
const BG = '#05080c';

const SCREEN_MENU = 'menu';
const SCREEN_PAUSE = 'pause';
const SCREEN_CHAMBER = 'chamber';
const SCREEN_SETTINGS = 'settings';

type MenuScreenId = typeof SCREEN_MENU | typeof SCREEN_PAUSE | typeof SCREEN_CHAMBER | typeof SCREEN_SETTINGS;

export class UISystem implements IUISystem {
  readonly name = 'ui';

  private ctx!: IGameContext;
  private root!: HTMLDivElement;
  private style!: HTMLStyleElement;
  private hud!: HTMLDivElement;
  private menu!: HTMLDivElement;
  private loading!: HTMLDivElement;
  private death!: HTMLDivElement;
  private complete!: HTMLDivElement;
  private fadeOverlay!: HTMLDivElement;

  private menuPanelMain!: HTMLDivElement;
  private menuPanelPause!: HTMLDivElement;
  private menuPanelChamber!: HTMLDivElement;
  private menuPanelSettings!: HTMLDivElement;
  private chamberListEl!: HTMLDivElement;

  private crosshair!: HTMLDivElement;
  private hudInteractText!: HTMLDivElement;
  private blueDot!: HTMLDivElement;
  private orangeDot!: HTMLDivElement;
  private subtitleText!: HTMLDivElement;
  private subtitleSpeaker!: HTMLDivElement;
  private subtitleContainer!: HTMLDivElement;
  private hintEl!: HTMLDivElement;

  private lastSettings?: Readonly<GameSettings>;
  private settingsInputs: Partial<Record<keyof GameSettings, HTMLInputElement | HTMLSelectElement>> = {};

  private subtitleQueue!: SubtitleQueue;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribers: Array<() => void> = [];

  private pendingFadeResolve: (() => void) | null = null;

  init(ctx: IGameContext): void {
    this.ctx = ctx;
    this.injectStyles();
    this.buildRoot();
    this.buildHud();
    this.buildMenu();
    this.buildLoading();
    this.buildDeath();
    this.buildComplete();
    this.buildFade();
    this.bindEvents();
    this.afterInit();
  }

  update(dtSeconds: number): void {
    this.subtitleQueue.tick(dtSeconds);
  }

  showMainMenu(): void {
    this.setMode('main');
    this.showMenuPanel(SCREEN_MENU);
    this.refreshContinueButton();
  }

  showPauseMenu(): void {
    this.setMode('pause');
    this.showMenuPanel(SCREEN_PAUSE);
  }

  showHUD(): void {
    this.setMode('hud');
  }

  hideAll(): void {
    this.setMode('none');
  }

  showLoading(definition: ChamberDefinition, levelIndex?: number): void {
    this.setMode('loading');
    const chamberNumber = levelIndex === undefined ? '' : `CHAMBER ${String(levelIndex + 1).padStart(2, '0')} — `;
    this.loading.querySelector('.pk-loading-title')!.textContent = chamberNumber + definition.name;
    const tagline = this.loading.querySelector('.pk-loading-tagline') as HTMLElement;
    tagline.textContent = definition.tagline ?? '';
    tagline.style.display = definition.tagline ? 'block' : 'none';
  }

  showSubtitle(text: string, durationSeconds?: number, speaker?: string): void {
    if (!this.lastSettings?.subtitles) return;
    this.subtitleQueue.enqueue(text, durationSeconds, speaker);
  }

  showHint(text: string): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.add('pk-visible');
    this.resetHintTimer();
  }

  setPortalIndicators(blue: boolean, orange: boolean): void {
    this.toggleClass(this.blueDot, 'pk-active', blue);
    this.toggleClass(this.orangeDot, 'pk-active', orange);
  }

  fadeToBlack(durationSeconds: number): Promise<void> {
    return this.runFade(1, durationSeconds);
  }

  fadeFromBlack(durationSeconds: number): Promise<void> {
    return this.runFade(0, durationSeconds);
  }

  dispose(): void {
    if (this.subtitleQueue) this.subtitleQueue.clear();
    this.unsubscribers.forEach((unsub) => unsub());
    this.unsubscribers = [];
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = null;
    this.pendingFadeResolve?.();
    this.pendingFadeResolve = null;
    this.style?.remove();
    this.root?.remove();
    this.root = undefined as unknown as HTMLDivElement;
  }

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  private injectStyles(): void {
    this.style = document.createElement('style');
    this.style.id = 'pk-ui-styles';
    this.style.textContent = UI_CSS;
    document.head.appendChild(this.style);
  }

  private buildRoot(): void {
    this.root = document.createElement('div');
    this.root.id = 'pk-ui-root';
    document.body.appendChild(this.root);
  }

  private buildHud(): void {
    this.hud = document.createElement('div');
    this.hud.className = 'pk-hud';
    this.hud.appendChild(this.buildCrosshair());
    this.hud.appendChild(this.buildPortalIndicators());
    this.hud.appendChild(this.buildSubtitles());
    this.hud.appendChild(this.buildHint());
    this.root.appendChild(this.hud);
  }

  private buildCrosshair(): HTMLDivElement {
    const container = document.createElement('div');
    container.className = 'pk-crosshair';

    const dot = document.createElement('div');
    dot.className = 'pk-crosshair-dot';
    container.appendChild(dot);

    const ticks: ['top', 'bottom', 'left', 'right'] = ['top', 'bottom', 'left', 'right'];
    ticks.forEach((pos) => {
      const tick = document.createElement('div');
      tick.className = `pk-crosshair-tick pk-${pos}`;
      container.appendChild(tick);
    });

    this.crosshair = container;
    return container;
  }

  private buildPortalIndicators(): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'pk-portal-indicators';

    const makeDot = (colorClass: 'pk-blue' | 'pk-orange') => {
      const dot = document.createElement('div');
      dot.className = `pk-portal-dot ${colorClass}`;
      return dot;
    };

    this.blueDot = makeDot('pk-blue');
    this.orangeDot = makeDot('pk-orange');
    wrap.appendChild(this.blueDot);
    wrap.appendChild(document.createElement('div'));
    wrap.appendChild(this.orangeDot);
    return wrap;
  }

  private buildSubtitles(): HTMLDivElement {
    this.subtitleContainer = document.createElement('div');
    this.subtitleContainer.className = 'pk-subtitle';

    this.subtitleSpeaker = document.createElement('div');
    this.subtitleSpeaker.className = 'pk-subtitle-speaker';
    this.subtitleContainer.appendChild(this.subtitleSpeaker);

    this.subtitleText = document.createElement('div');
    this.subtitleText.className = 'pk-subtitle-text';
    this.subtitleContainer.appendChild(this.subtitleText);

    this.subtitleQueue = new SubtitleQueue({
      onShow: (text: string, speaker?: string) => {
        this.subtitleText.textContent = text;
        this.subtitleSpeaker.textContent = speaker ?? '';
        this.subtitleSpeaker.style.display = speaker ? 'block' : 'none';
        this.subtitleContainer.classList.add('pk-visible');
      },
      onHide: () => {
        this.subtitleContainer.classList.remove('pk-visible');
      },
    });

    return this.subtitleContainer;
  }

  private buildHint(): HTMLDivElement {
    this.hintEl = document.createElement('div');
    this.hintEl.className = 'pk-hint';
    return this.hintEl;
  }

  private buildMenu(): void {
    this.menu = document.createElement('div');
    this.menu.className = 'pk-menu-screen';

    this.menuPanelMain = this.createPanel('pk-main-menu');
    this.menuPanelPause = this.createPanel('pk-pause-menu');
    this.menuPanelChamber = this.createPanel('pk-chamber-select');
    this.menuPanelSettings = this.createPanel('pk-settings');

    this.fillMainMenu();
    this.fillPauseMenu();
    this.fillChamberPanel();
    this.fillSettingsPanel();

    this.menu.append(this.menuPanelMain, this.menuPanelPause, this.menuPanelChamber, this.menuPanelSettings);
    this.root.appendChild(this.menu);
  }

  private createPanel(extraClass: string): HTMLDivElement {
    const panel = document.createElement('div');
    panel.className = `pk-menu-panel ${extraClass}`;
    panel.style.display = 'none';
    return panel;
  }

  private fillMainMenu(): void {
    const panel = this.menuPanelMain;
    panel.appendChild(this.makeTitle('PORTAL-KIMI', 'MOBILE Aperture Sciences'));

    const continueBtn = this.makeButton('CONTINUE');
    continueBtn.id = 'pk-btn-continue';
    continueBtn.onclick = () => {
      const index = this.ctx.systems.levels.unlockedLevelIndex;
      this.emit('level:loadRequested', { levelIndex: index });
    };

    panel.append(
      this.makeButton('BEGIN TESTING', () => this.emit('level:loadRequested', { levelIndex: 0 })),
      continueBtn,
      this.makeButton('CHAMBER SELECT', () => this.showMenuPanel(SCREEN_CHAMBER)),
      this.makeButton('SETTINGS', () => this.showMenuPanel(SCREEN_SETTINGS)),
      this.makeButton('QUIT', () => { /* browsers ignore window.close() unless the window was opened by script */ try { window.close(); } catch { /* no-op */ } }),
    );
  }

  private fillPauseMenu(): void {
    const panel = this.menuPanelPause;
    panel.appendChild(this.makeTitle('PAUSED', 'TESTING SUSPENDED'));
    panel.append(
      this.makeButton('RESUME', () => this.emit('game:resumeRequested', {})),
      this.makeButton('RESTART CHAMBER', () => this.emit('level:restartRequested', {})),
      this.makeButton('SETTINGS', () => this.showMenuPanel(SCREEN_SETTINGS)),
      this.makeButton('QUIT TO MENU', () => this.emit('game:quitToMenu', {})),
    );
  }

  private fillChamberPanel(): void {
    const panel = this.menuPanelChamber;
    panel.appendChild(this.makeTitle('CHAMBER SELECT'));

    const listWrap = document.createElement('div');
    listWrap.className = 'pk-chamber-list';
    this.chamberListEl = listWrap;
    panel.appendChild(listWrap);

    panel.appendChild(this.makeButton('BACK', () => this.showMenuPanel(this.currentMode === 'pause' ? SCREEN_PAUSE : SCREEN_MENU)));
  }

  private fillSettingsPanel(): void {
    const panel = this.menuPanelSettings;
    panel.appendChild(this.makeTitle('SETTINGS'));

    const form = document.createElement('div');
    form.className = 'pk-settings-form';

    this.addSliderRow(form, 'MASTER VOLUME', 'masterVolume', 0, 1, 0.01);
    this.addSliderRow(form, 'MUSIC VOLUME', 'musicVolume', 0, 1, 0.01);
    this.addSliderRow(form, 'SFX VOLUME', 'sfxVolume', 0, 1, 0.01);
    this.addSliderRow(form, 'MOUSE SENSITIVITY', 'mouseSensitivity', 0.1, 10, 0.1);
    this.addSliderRow(form, 'FOV', 'fovDegrees', 60, 120, 1);
    this.addToggleRow(form, 'INVERT Y', 'invertY');
    this.addToggleRow(form, 'SUBTITLES', 'subtitles');
    this.addQualityRow(form);

    panel.appendChild(form);
    panel.appendChild(this.makeButton('BACK', () => this.showMenuPanel(this.currentMode === 'pause' ? SCREEN_PAUSE : SCREEN_MENU)));
  }

  private buildLoading(): void {
    this.loading = document.createElement('div');
    this.loading.className = 'pk-loading';
    this.loading.innerHTML = `
      <div class="pk-loading-label">LOADING</div>
      <div class="pk-loading-title"></div>
      <div class="pk-loading-tagline"></div>
    `;
    this.root.appendChild(this.loading);
  }

  private buildDeath(): void {
    this.death = document.createElement('div');
    this.death.className = 'pk-death';
    this.death.innerHTML = `
      <div class="pk-death-line"></div>
      <div class="pk-death-title">TEST SUBJECT TERMINATED</div>
      <div class="pk-death-line"></div>
    `;
    this.root.appendChild(this.death);
  }

  private buildComplete(): void {
    this.complete = document.createElement('div');
    this.complete.className = 'pk-complete';
    this.complete.innerHTML = `<div class="pk-complete-title">CHAMBER COMPLETE</div>`;
    this.root.appendChild(this.complete);
  }

  private buildFade(): void {
    this.fadeOverlay = document.createElement('div');
    this.fadeOverlay.className = 'pk-fade';
    this.root.appendChild(this.fadeOverlay);
  }

  private afterInit(): void {
    this.hideAll();
    this.refreshSettingsControls(this.ctx.settings.settings);
  }

  // ---------------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------------

  private bindEvents(): void {
    const bus = this.ctx.events;
    this.unsubscribers.push(
      bus.on('game:stateChanged', ({ to }) => this.handleStateChange(to)),
      bus.on('level:loading', ({ levelIndex, definition }) => {
        // Drop any subtitle still playing from the previous chamber.
        this.subtitleQueue?.clear();
        this.showLoading(definition, levelIndex);
      }),
      bus.on('level:loaded', () => this.showHUD()),
      bus.on('level:completed', () => this.showChamberComplete()),
      bus.on('player:interactPrompt', ({ text }) => this.setInteractPrompt(text)),
      bus.on('player:died', () => this.showDeath()),
      bus.on('ui:subtitle', ({ text, durationSeconds, speaker }) => this.showSubtitle(text, durationSeconds, speaker)),
      bus.on('ui:hint', ({ text }) => this.showHint(text)),
      bus.on('portal:placed', ({ color }) => this.updatePortalIndicator(color, true)),
      bus.on('portal:cleared', ({ color }) => this.updatePortalIndicator(color, false)),
      bus.on('settings:changed', ({ settings }) => this.onSettingsChanged(settings)),
    );
  }

  private handleStateChange(state: GameState): void {
    if (state === 'dead') this.showDeath();
    if (state === 'chamberComplete') this.showChamberComplete();
  }

  private onSettingsChanged(settings: Readonly<GameSettings>): void {
    this.lastSettings = settings;
    this.refreshSettingsControls(settings);
  }

  private setInteractPrompt(text: string | null): void {
    if (text) {
      this.crosshair.classList.add('pk-expand');
      this.hudInteractText ??= this.makeHudInteractText();
      this.hudInteractText.textContent = text;
      this.hudInteractText.classList.add('pk-visible');
    } else {
      this.crosshair.classList.remove('pk-expand');
      this.hudInteractText?.classList.remove('pk-visible');
    }
  }

  private makeHudInteractText(): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'pk-interact-text';
    this.hud.appendChild(el);
    return el;
  }

  private updatePortalIndicator(color: 'blue' | 'orange', active: boolean): void {
    if (color === 'blue') {
      this.setPortalIndicators(active, this.orangeDot.classList.contains('pk-active'));
    } else {
      this.setPortalIndicators(this.blueDot.classList.contains('pk-active'), active);
    }
  }

  // ---------------------------------------------------------------------------
  // Screen management
  // ---------------------------------------------------------------------------

  private currentMode: 'none' | 'main' | 'pause' | 'loading' | 'dead' | 'complete' | 'hud' = 'none';

  private setMode(mode: typeof this.currentMode): void {
    this.currentMode = mode;
    this.root.className = 'pk-root pk-mode-' + mode;

    const show: Record<typeof this.currentMode, boolean> = {
      none: false,
      main: true,
      pause: true,
      loading: true,
      dead: true,
      complete: true,
      hud: true,
    };
    this.root.style.display = show[mode] ? 'block' : 'none';

    this.menu.style.display = mode === 'main' || mode === 'pause' ? 'flex' : 'none';
    this.hud.style.display = mode === 'hud' ? 'block' : 'none';
    this.loading.style.display = mode === 'loading' ? 'flex' : 'none';
    this.death.style.display = mode === 'dead' ? 'flex' : 'none';
    this.complete.style.display = mode === 'complete' ? 'flex' : 'none';

    if (mode !== 'main' && mode !== 'pause') {
      this.menuPanelMain.style.display = 'none';
      this.menuPanelPause.style.display = 'none';
      this.menuPanelChamber.style.display = 'none';
      this.menuPanelSettings.style.display = 'none';
    }
  }

  private showMenuPanel(panel: MenuScreenId): void {
    this.menuPanelMain.style.display = 'none';
    this.menuPanelPause.style.display = 'none';
    this.menuPanelChamber.style.display = 'none';
    this.menuPanelSettings.style.display = 'none';

    const elementForPanel: Record<MenuScreenId, HTMLDivElement> = {
      [SCREEN_MENU]: this.menuPanelMain,
      [SCREEN_PAUSE]: this.menuPanelPause,
      [SCREEN_CHAMBER]: this.menuPanelChamber,
      [SCREEN_SETTINGS]: this.menuPanelSettings,
    };

    elementForPanel[panel].style.display = 'flex';

    if (panel === SCREEN_CHAMBER) {
      this.renderChamberList();
    }

    if (panel === SCREEN_SETTINGS) {
      this.refreshSettingsControls(this.ctx.settings.settings);
    }
  }

  private showChamberComplete(): void {
    this.setMode('complete');
  }

  private showDeath(): void {
    this.setMode('dead');
  }

  // ---------------------------------------------------------------------------
  // Menu widgets
  // ---------------------------------------------------------------------------

  private makeTitle(primary: string, secondary?: string): HTMLDivElement {
    const wrap = document.createElement('div');
    wrap.className = 'pk-menu-title';

    const h1 = document.createElement('h1');
    h1.textContent = primary;
    wrap.appendChild(h1);

    if (secondary) {
      const span = document.createElement('span');
      span.textContent = secondary;
      wrap.appendChild(span);
    }

    return wrap;
  }

  private makeButton(label: string, onClick?: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pk-btn';
    btn.textContent = label;
    if (onClick) {
      btn.addEventListener('click', () => {
        this.playUiSound('ui.click');
        onClick();
      });
    }
    btn.addEventListener('pointerenter', () => this.playUiSound('ui.hover'));
    return btn;
  }

  private refreshContinueButton(): void {
    const unlocked = this.ctx.systems.levels.unlockedLevelIndex;
    const entries = this.ctx.systems.levels.getLevelList();
    const btn = document.getElementById('pk-btn-continue') as HTMLButtonElement | null;
    if (!btn) return;

    if (unlocked <= 0 || unlocked >= entries.length) {
      btn.style.display = 'none';
      return;
    }

    const entry = entries[unlocked];
    btn.style.display = 'block';
    btn.textContent = entry ? `CONTINUE: ${entry.name}` : 'CONTINUE';
  }

  private renderChamberList(): void {
    this.chamberListEl.innerHTML = '';
    const entries = this.ctx.systems.levels.getLevelList();
    if (entries.length === 0) {
      this.chamberListEl.textContent = 'NO CHAMBERS FOUND';
      return;
    }

    entries.forEach((entry, index) => {
      const row = document.createElement('button');
      row.className = 'pk-chamber-row';
      row.type = 'button';

      if (entry.locked) {
        row.disabled = true;
        row.classList.add('pk-locked');
        row.textContent = `[LOCKED] ${index + 1}. ${entry.name}`;
      } else {
        row.textContent = `${index + 1}. ${entry.name}`;
        if (entry.completed) row.textContent += ' ✅';
        row.onclick = () => this.emit('level:loadRequested', { levelIndex: index });
      }

      row.addEventListener('pointerenter', () => this.playUiSound('ui.hover'));
      this.chamberListEl.appendChild(row);
    });
  }

  // ---------------------------------------------------------------------------
  // Settings controls
  // ---------------------------------------------------------------------------

  private addSliderRow(
    parent: HTMLElement,
    labelText: string,
    field: keyof GameSettings,
    min: number,
    max: number,
    step: number,
  ): void {
    const row = document.createElement('label');
    row.className = 'pk-setting-row';

    const span = document.createElement('span');
    span.textContent = labelText;

    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = String(step);
    range.addEventListener('input', () => this.applySetting(field, range.value));

    const valueLabel = document.createElement('span');
    valueLabel.className = 'pk-setting-value';
    valueLabel.id = `pk-val-${String(field)}`;

    row.append(span, range, valueLabel);
    parent.appendChild(row);
    this.settingsInputs[field] = range;
  }

  private addToggleRow(parent: HTMLElement, labelText: string, field: keyof GameSettings): void {
    const row = document.createElement('label');
    row.className = 'pk-setting-row pk-toggle';

    const span = document.createElement('span');
    span.textContent = labelText;

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.addEventListener('change', () => this.applySetting(field, check.checked ? 'true' : 'false'));

    row.append(span, check);
    parent.appendChild(row);
    this.settingsInputs[field] = check;
  }

  private addQualityRow(parent: HTMLElement): void {
    const row = document.createElement('label');
    row.className = 'pk-setting-row';

    const span = document.createElement('span');
    span.textContent = 'QUALITY';

    const select = document.createElement('select');
    const options: Array<'low' | 'medium' | 'high' | 'ultra'> = ['low', 'medium', 'high', 'ultra'];
    options.forEach((opt) => {
      const option = document.createElement('option');
      option.value = opt;
      option.textContent = opt.toUpperCase();
      select.appendChild(option);
    });
    select.addEventListener('change', () => this.applySetting('quality', select.value));

    row.append(span, select);
    parent.appendChild(row);
    this.settingsInputs.quality = select;
  }

  private applySetting(field: keyof GameSettings, raw: string): void {
    const patch = buildSettingsPatch(field, raw);
    if (Object.keys(patch).length === 0) return;
    this.ctx.settings.update(patch);
  }

  private refreshSettingsControls(settings: Readonly<GameSettings>): void {
    this.lastSettings = settings;
    this.setInput('masterVolume', String(settings.masterVolume));
    this.setInput('musicVolume', String(settings.musicVolume));
    this.setInput('sfxVolume', String(settings.sfxVolume));
    this.setInput('mouseSensitivity', String(settings.mouseSensitivity));
    this.setInput('fovDegrees', String(settings.fovDegrees));
    this.setInput('invertY', settings.invertY ? 'true' : 'false');
    this.setInput('subtitles', settings.subtitles ? 'true' : 'false');
    this.setInput('quality', settings.quality);

    [
      'masterVolume',
      'musicVolume',
      'sfxVolume',
      'mouseSensitivity',
      'fovDegrees',
    ].forEach((key) => this.updateValueLabel(key as keyof GameSettings, settings));
  }

  private setInput(field: keyof GameSettings, value: string): void {
    const input = this.settingsInputs[field];
    if (!input) return;
    if (input.type === 'checkbox') {
      (input as HTMLInputElement).checked = value === 'true';
    } else {
      input.value = value;
    }
  }

  private updateValueLabel(field: keyof GameSettings, settings: Readonly<GameSettings>): void {
    const label = document.getElementById(`pk-val-${String(field)}`);
    if (!label) return;
    const raw = settings[field as keyof GameSettings] as number;
    label.textContent = Number.isInteger(raw) ? String(raw) : raw.toFixed(2);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private emit<K extends keyof GameEventMap>(event: K, payload: GameEventMap[K]): void {
    this.ctx.events.emit(event, payload);
  }

  private playUiSound(soundId: string): void {
    try {
      this.ctx.systems.audio.play(soundId, { volume: 0.6 });
    } catch {
      // Audio may not be ready; ignore.
    }
  }

  private resetHintTimer(): void {
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      this.hintEl.classList.remove('pk-visible');
      this.hintTimer = null;
    }, HINT_DURATION_MS);
  }

  private runFade(targetOpacity: 0 | 1, durationSeconds: number): Promise<void> {
    const overlay = this.fadeOverlay;
    overlay.style.transition = `opacity ${clamp(durationSeconds, 0, 60)}s ease`;
    overlay.style.opacity = String(targetOpacity);

    if (this.pendingFadeResolve) {
      this.pendingFadeResolve();
      this.pendingFadeResolve = null;
    }

    return new Promise<void>((resolve) => {
      this.pendingFadeResolve = resolve;
      const cleanup = () => {
        overlay.removeEventListener('transitionend', onEnd);
        if (this.pendingFadeResolve === resolve) this.pendingFadeResolve = null;
        resolve();
      };

      const onEnd = (): void => {
        if (this.pendingFadeResolve === resolve) cleanup();
      };

      overlay.addEventListener('transitionend', onEnd, { once: true });
      setTimeout(() => {
        if (this.pendingFadeResolve === resolve) cleanup();
      }, clamp(durationSeconds, 0, 60) * 1000 + 50);
    });
  }

  private toggleClass(el: HTMLElement, className: string, active: boolean): void {
    if (active) el.classList.add(className);
    else el.classList.remove(className);
  }
}

const HINT_DURATION_MS = 6000;

const UI_CSS = `
#pk-ui-root {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: none;
  font-family: 'Segoe UI', Roboto, Helvetica, Arial, system-ui, sans-serif;
  color: ${TEXT};
  text-transform: uppercase;
  letter-spacing: 0.22em;
  user-select: none;
  pointer-events: none;
}

.pk-hud {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.pk-menu-screen {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at 50% 50%, rgba(6, 16, 26, 0.96) 0%, ${BG} 72%);
  pointer-events: auto;
  overflow: hidden;
}

.pk-menu-screen::before {
  content: '';
  position: absolute;
  inset: -10%;
  background: repeating-linear-gradient(
    0deg,
    transparent 0,
    transparent 48px,
    rgba(110, 193, 255, 0.03) 48px,
    rgba(110, 193, 255, 0.03) 49px
  );
  animation: pk-grid-shimmer 8s linear infinite;
  pointer-events: none;
}

@keyframes pk-grid-shimmer {
  0% { transform: translateY(0); }
  100% { transform: translateY(49px); }
}

.pk-menu-panel {
  position: relative;
  z-index: 1;
  display: none;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  min-width: 320px;
  max-width: 680px;
  max-height: 90vh;
  overflow: auto;
  padding: 32px;
}

.pk-menu-title {
  text-align: center;
  margin-bottom: 18px;
}

.pk-menu-title h1 {
  font-size: 2.4rem;
  font-weight: 200;
  color: ${ACCENT};
  margin: 0;
  letter-spacing: 0.5em;
}

.pk-menu-title span {
  display: block;
  margin-top: 8px;
  font-size: 0.76rem;
  color: rgba(207, 227, 245, 0.6);
  letter-spacing: 0.35em;
}

.pk-btn {
  appearance: none;
  background: transparent;
  border: 1px solid ${ACCENT};
  color: ${ACCENT};
  padding: 14px 42px;
  font-size: 0.85rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  cursor: pointer;
  min-width: 280px;
  transition: background-color 180ms ease, color 180ms ease, transform 120ms ease;
}

.pk-btn:hover:not(:disabled) {
  background: rgba(110, 193, 255, 0.12);
}

.pk-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.pk-btn:disabled {
  border-color: rgba(110, 193, 255, 0.3);
  color: rgba(207, 227, 245, 0.35);
  cursor: not-allowed;
}

.pk-chamber-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-height: 42vh;
  overflow-y: auto;
  padding: 8px 0;
}

.pk-chamber-row {
  appearance: none;
  background: rgba(207, 227, 245, 0.04);
  border: 1px solid rgba(110, 193, 255, 0.18);
  color: ${TEXT};
  padding: 12px 18px;
  font-size: 0.78rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease;
}

.pk-chamber-row:hover:not(:disabled) {
  background: rgba(110, 193, 255, 0.1);
  border-color: ${ACCENT};
}

.pk-chamber-row.pk-locked {
  opacity: 0.45;
  cursor: not-allowed;
}

.pk-settings-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  padding: 8px 0;
}

.pk-setting-row {
  display: grid;
  grid-template-columns: 140px 1fr 48px;
  align-items: center;
  gap: 16px;
  font-size: 0.72rem;
  color: rgba(207, 227, 245, 0.85);
}

.pk-setting-row.pk-toggle {
  grid-template-columns: 1fr auto;
}

.pk-setting-row input[type='range'] {
  width: 100%;
  accent-color: ${ACCENT};
}

.pk-setting-row select {
  background: transparent;
  color: ${TEXT};
  border: 1px solid ${ACCENT};
  padding: 6px 8px;
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.pk-setting-value {
  text-align: right;
  color: ${ACCENT};
  font-variant-numeric: tabular-nums;
}

.pk-crosshair {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 40px;
  height: 40px;
  transform: translate(-50%, -50%);
}

.pk-crosshair-dot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 4px;
  height: 4px;
  background: ${TEXT};
  border-radius: 50%;
  transform: translate(-50%, -50%);
  transition: transform 150ms ease;
}

.pk-crosshair-tick {
  position: absolute;
  width: 6px;
  height: 1px;
  background: ${ACCENT};
  transition: transform 150ms ease, opacity 150ms ease;
}

.pk-crosshair-tick.pk-top { left: 17px; top: 8px; }
.pk-crosshair-tick.pk-bottom { left: 17px; bottom: 8px; }
.pk-crosshair-tick.pk-left { left: 8px; top: 17px; transform: rotate(90deg); }
.pk-crosshair-tick.pk-right { right: 8px; top: 17px; transform: rotate(90deg); }

.pk-crosshair.pk-expand .pk-crosshair-dot {
  transform: translate(-50%, -50%) scale(1.6);
}
.pk-crosshair.pk-expand .pk-crosshair-tick.pk-top { transform: translateY(-3px); }
.pk-crosshair.pk-expand .pk-crosshair-tick.pk-bottom { transform: translateY(3px); }
.pk-crosshair.pk-expand .pk-crosshair-tick.pk-left { transform: rotate(90deg) translateY(-3px); }
.pk-crosshair.pk-expand .pk-crosshair-tick.pk-right { transform: rotate(90deg) translateY(3px); }

.pk-interact-text {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, 26px);
  color: ${TEXT};
  font-size: 0.7rem;
  letter-spacing: 0.16em;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 150ms ease;
}

.pk-interact-text.pk-visible {
  opacity: 1;
}

.pk-portal-indicators {
  position: absolute;
  left: 28px;
  bottom: 28px;
  display: flex;
  align-items: center;
  gap: 12px;
}

.pk-portal-indicators > div:nth-child(2) {
  width: 24px;
  height: 1px;
  background: rgba(207, 227, 245, 0.25);
}

.pk-portal-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid rgba(207, 227, 245, 0.35);
  background: transparent;
  transition: background-color 180ms ease, box-shadow 180ms ease, transform 180ms ease;
}

.pk-portal-dot.pk-blue { border-color: ${ACCENT}; }
.pk-portal-dot.pk-orange { border-color: ${ACCENT_ORANGE}; }

.pk-portal-dot.pk-blue.pk-active {
  background: ${ACCENT};
  box-shadow: 0 0 10px ${ACCENT};
}
.pk-portal-dot.pk-orange.pk-active {
  background: ${ACCENT_ORANGE};
  box-shadow: 0 0 10px ${ACCENT_ORANGE};
}

.pk-subtitle {
  position: absolute;
  left: 50%;
  bottom: 56px;
  transform: translateX(-50%);
  text-align: center;
  opacity: 0;
  transition: opacity 180ms ease;
  max-width: 66vw;
}

.pk-subtitle.pk-visible { opacity: 1; }

.pk-subtitle-speaker {
  font-size: 0.6rem;
  letter-spacing: 0.3em;
  color: ${ACCENT};
  margin-bottom: 6px;
}

.pk-subtitle-text {
  font-size: 1.05rem;
  font-weight: 300;
  letter-spacing: 0.06em;
  line-height: 1.35;
  color: ${TEXT};
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
}

.pk-hint {
  position: absolute;
  right: 28px;
  bottom: 28px;
  padding: 10px 16px;
  background: rgba(5, 8, 12, 0.82);
  border: 1px solid rgba(110, 193, 255, 0.35);
  color: ${TEXT};
  font-size: 0.72rem;
  letter-spacing: 0.1em;
  opacity: 0;
  transition: opacity 250ms ease;
  max-width: 320px;
  pointer-events: auto;
}

.pk-hint.pk-visible { opacity: 1; }

.pk-loading,
.pk-death,
.pk-complete {
  position: absolute;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  background: ${BG};
  text-align: center;
}

.pk-loading-label {
  font-size: 0.72rem;
  letter-spacing: 0.5em;
  color: ${ACCENT};
  margin-bottom: 16px;
}

.pk-loading-title {
  font-size: 2rem;
  font-weight: 200;
  letter-spacing: 0.25em;
  color: ${TEXT};
}

.pk-loading-tagline {
  margin-top: 10px;
  font-size: 0.82rem;
  letter-spacing: 0.15em;
  color: rgba(207, 227, 245, 0.65);
}

.pk-death {
  background: radial-gradient(circle at 50% 50%, rgba(120, 20, 20, 0.38) 0%, ${BG} 74%);
  animation: pk-death-pulse 2.2s ease-in-out infinite;
}
@keyframes pk-death-pulse {
  0% { opacity: 0.95; transform: scale(1); filter: brightness(1); }
  50% { opacity: 1; transform: scale(1.03); filter: brightness(1.12); }
  100% { opacity: 0.95; transform: scale(1); filter: brightness(1); }
}
.pk-death-title { font-size: 1.4rem; letter-spacing: 0.2em; color: #ff9fa3; }
.pk-death-line { width: 120px; height: 1px; background: rgba(255, 159, 163, 0.5); margin: 16px 0; }

.pk-complete { animation: pk-complete-entrance 0.65s ease-out; }
@keyframes pk-complete-entrance {
  from { opacity: 0; transform: scale(0.96) translateY(30px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.pk-complete-title { font-size: 1.8rem; font-weight: 200; letter-spacing: 0.35em; color: ${ACCENT}; }

.pk-fade {
  position: absolute;
  inset: 0;
  background: #000;
  opacity: 0;
  pointer-events: none;
  z-index: 200;
}

/* Helper visibility: keep hidden overlays from intercepting pointer events. */
.pk-loading, .pk-death, .pk-complete { pointer-events: none; }
`;
