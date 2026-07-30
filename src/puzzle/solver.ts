/**
 * puzzle/solver.ts — Pure AND/OR/invert link solver for Aperture test chambers.
 */

type SourceId = string;
type TargetId = string;

interface TargetConfig {
  readonly require: 'all' | 'any';
  readonly defaultActive: boolean;
}

interface Link {
  readonly sourceId: SourceId;
  readonly targetId: TargetId;
  readonly invert: boolean;
}

interface TargetState {
  config: TargetConfig;
  links: Link[];
  active: boolean;
}

/** Evaluate a target from its source contributions. */
export function evaluateTarget(
  contributions: readonly boolean[],
  require: 'all' | 'any',
  defaultValue: boolean,
): boolean {
  if (contributions.length === 0) {
    return defaultValue;
  }
  if (require === 'all') {
    return contributions.every(Boolean);
  }
  return contributions.some(Boolean);
}

/**
 * Persistent solver linking source elements to reactor elements.
 * Source elements report active/inactive; the solver computes the resulting
 * activation for every target and invokes `onActivationChange` when it changes.
 */
export class LinkSolver {
  private readonly sourceStates = new Map<SourceId, boolean>();
  private readonly targets = new Map<TargetId, TargetState>();
  private readonly linksBySource = new Map<SourceId, Link[]>();
  private pendingCallback: ((targetId: TargetId, active: boolean) => void) | null = null;

  /** Register a reactor target. Safe to call multiple times with the same id. */
  registerTarget(targetId: TargetId, require: 'all' | 'any', defaultActive = false): void {
    const existing = this.targets.get(targetId);
    if (!existing) {
      this.targets.set(targetId, {
        config: { require, defaultActive },
        links: [],
        active: defaultActive,
      });
    }
  }

  /** Add a directional link. */
  addLink(sourceId: SourceId, targetId: TargetId, invert = false): void {
    const link: Link = { sourceId, targetId, invert };
    const state = this.targets.get(targetId);
    if (state) {
      state.links.push(link);
    }
    let list = this.linksBySource.get(sourceId);
    if (!list) {
      list = [];
      this.linksBySource.set(sourceId, list);
    }
    list.push(link);
  }

  /** Attach an activation change listener. */
  onActivationChange(callback: (targetId: TargetId, active: boolean) => void): void {
    this.pendingCallback = callback;
  }

  /**
   * Update the recorded state of a source element and recompute any targets
   * connected to it.
   */
  setSourceActive(sourceId: SourceId, active: boolean): void {
    const current = this.sourceStates.get(sourceId);
    if (current === active) return;
    this.sourceStates.set(sourceId, active);

    const links = this.linksBySource.get(sourceId);
    if (!links) return;

    for (const link of links) {
      this.updateTarget(link.targetId, sourceId);
    }
  }

  /**
   * Recompute every target and fire the callback exactly once per target.
   * This is used to apply initial/default states after a chamber is built.
   */
  reset(): void {
    for (const [targetId, state] of this.targets) {
      const active = this.computeTargetActive(state);
      if (state.active !== active) {
        state.active = active;
      }
      this.pendingCallback?.(targetId, state.active);
    }
  }

  private computeTargetActive(state: TargetState): boolean {
    const contributions: boolean[] = [];
    for (const link of state.links) {
      const sourceActive = this.sourceStates.get(link.sourceId) ?? false;
      contributions.push(link.invert ? !sourceActive : sourceActive);
    }
    return evaluateTarget(contributions, state.config.require, state.config.defaultActive);
  }

  private updateTarget(targetId: TargetId, changedSource: SourceId | undefined): void {
    const state = this.targets.get(targetId);
    if (!state) return;

    // If a specific source changed and no link connects it to this target, skip.
    if (
      changedSource !== undefined &&
      !state.links.some((l) => l.sourceId === changedSource)
    ) {
      return;
    }

    const active = this.computeTargetActive(state);
    if (state.active === active) return;
    state.active = active;
    this.pendingCallback?.(targetId, active);
  }
}
