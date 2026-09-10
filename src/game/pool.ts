/** Bounded reusable storage. Owners remove an object from live collections before release. */
export class ObjectPool<T> {
  private readonly free: T[] = [];
  private allocations = 0;

  constructor(
    private readonly factory: () => T,
    private readonly reset?: (value: T) => void,
    private readonly maxRetained = 4096,
  ) {}

  acquire(): T {
    const value = this.free.pop();
    if (value !== undefined) return value;
    this.allocations++;
    return this.factory();
  }

  release(value: T): void {
    this.reset?.(value);
    if (this.free.length < this.maxRetained) this.free.push(value);
  }

  clear(): void { this.free.length = 0; }
  get size(): number { return this.free.length; }
  get created(): number { return this.allocations; }
}
