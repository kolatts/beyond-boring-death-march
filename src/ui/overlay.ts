/**
 * DOM overlay + typed event bus.
 *
 * Phaser owns the canvas; all HTML/CSS UI lives in the #overlay element and
 * talks to the game through this bus. No React — a framework here buys
 * nothing and costs bundle size (spec §3, DECISIONS.md).
 */

/**
 * Central event map. Systems add their events here as the game grows;
 * keys are event names, values are payload types.
 */
export interface GameEvents {
  /** A scene has finished booting and is ready for overlay UI. */
  'scene:ready': { scene: string };
  /** Show a DOM panel by id (panels are registered by later phases). */
  'overlay:show': { panel: string };
  /** Hide the current DOM panel. */
  'overlay:hide': { panel: string };
}

type EventKey = keyof GameEvents;
type Handler<K extends EventKey> = (payload: GameEvents[K]) => void;

class EventBus {
  private handlers = new Map<EventKey, Set<(payload: never) => void>>();

  on<K extends EventKey>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return () => this.off(event, handler);
  }

  off<K extends EventKey>(event: K, handler: Handler<K>): void {
    this.handlers.get(event)?.delete(handler as (payload: never) => void);
  }

  emit<K extends EventKey>(event: K, payload: GameEvents[K]): void {
    this.handlers.get(event)?.forEach((handler) => {
      (handler as Handler<K>)(payload);
    });
  }
}

/** Singleton bus shared by Phaser scenes and DOM overlay components. */
export const bus = new EventBus();

/** The overlay root element. Guaranteed present by index.html. */
export function overlayRoot(): HTMLElement {
  const el = document.getElementById('overlay');
  if (!el) {
    throw new Error('#overlay root missing from index.html');
  }
  return el;
}

/**
 * Create (or replace) a named overlay panel. Returns the panel element.
 * Panels are plain divs; callers style and fill them.
 */
export function mountPanel(id: string): HTMLElement {
  const root = overlayRoot();
  document.getElementById(`panel-${id}`)?.remove();
  const panel = document.createElement('div');
  panel.id = `panel-${id}`;
  root.appendChild(panel);
  return panel;
}

/** Remove a named overlay panel if it exists. */
export function unmountPanel(id: string): void {
  document.getElementById(`panel-${id}`)?.remove();
}
