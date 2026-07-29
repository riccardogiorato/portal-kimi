/**
 * core/EventBus.ts — Typed publish/subscribe bus.
 *
 * Every cross-system message flows through here using the GameEventMap
 * contract. Handlers are isolated: a throwing handler is logged and never
 * breaks other subscribers or the emitter.
 */
import type { GameEventMap } from './types';

export type EventHandler<K extends keyof GameEventMap> = (payload: GameEventMap[K]) => void;

type AnyHandler = (payload: never) => void;

export class EventBus {
  private readonly handlers = new Map<keyof GameEventMap, Set<AnyHandler>>();

  on<K extends keyof GameEventMap>(event: K, handler: EventHandler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as AnyHandler);
    return () => this.off(event, handler);
  }

  once<K extends keyof GameEventMap>(event: K, handler: EventHandler<K>): () => void {
    const unsubscribe = this.on(event, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  off<K extends keyof GameEventMap>(event: K, handler: EventHandler<K>): void {
    this.handlers.get(event)?.delete(handler as AnyHandler);
  }

  emit<K extends keyof GameEventMap>(event: K, payload: GameEventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    // Copy: handlers may unsubscribe during emission.
    for (const handler of [...set]) {
      try {
        (handler as EventHandler<K>)(payload);
      } catch (error) {
        console.error(`[EventBus] handler for "${String(event)}" threw:`, error);
      }
    }
  }

  /** Remove every subscription. Used on full game teardown only. */
  clear(): void {
    this.handlers.clear();
  }
}
