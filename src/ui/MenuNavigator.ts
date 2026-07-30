/** Wraps a list of selectable menu items with wrapping navigation. */
export class MenuNavigator<T> {
  index = 0;

  constructor(private readonly items: readonly T[]) {
    if (items.length === 0) this.index = -1;
  }

  next(): number {
    if (this.items.length === 0) return -1;
    this.index = (this.index + 1) % this.items.length;
    return this.index;
  }

  previous(): number {
    if (this.items.length === 0) return -1;
    this.index = (this.index - 1 + this.items.length) % this.items.length;
    return this.index;
  }

  select(index: number): boolean {
    if (index < 0 || index >= this.items.length) return false;
    this.index = index;
    return true;
  }

  setItems(items: readonly T[]): void {
    (this as unknown as { items: readonly T[] }).items = items;
    this.index = items.length > 0 ? Math.min(this.index, items.length - 1) : -1;
  }

  current(): T | null {
    return this.items[this.index] ?? null;
  }
}
