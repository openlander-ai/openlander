/**
 * Entry stored in the ring buffer with automatic timestamp wrapping.
 */
export interface RingBufferEntry<T> {
  data: T;
  timestamp: number;
}

/**
 * Options for filtering entries in getRecent.
 */
export interface GetRecentOptions {
  /** Only return entries with timestamp >= since */
  since?: number;
}

/**
 * Generic fixed-size circular buffer with automatic timestamp wrapping.
 * Oldest entries are automatically evicted when capacity is exceeded.
 */
export class RingBuffer<T> {
  private entries: RingBufferEntry<T>[] = [];
  private writeIndex = 0;
  private isFull = false;

  /**
   * Create a new RingBuffer.
   * @param capacity Maximum number of entries to store (default: 1000)
   * @throws If capacity <= 0
   */
  constructor(readonly capacity: number = 1000) {
    if (capacity <= 0) {
      throw new Error('Capacity must be greater than 0');
    }
    this.entries = new Array<RingBufferEntry<T>>(capacity);
  }

  /**
   * Add an item to the buffer, wrapping with current timestamp.
   */
  push(item: T): void {
    this.entries[this.writeIndex] = {
      data: item,
      timestamp: Date.now(),
    };

    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.writeIndex === 0) {
      this.isFull = true;
    }
  }

  /**
   * Get the most recent n items, optionally filtered by timestamp.
   */
  getRecent(n: number, options?: GetRecentOptions): RingBufferEntry<T>[] {
    if (n <= 0) return [];

    const all = this.getAll();
    let result = all.slice(-n);

    if (options?.since !== undefined) {
      const since = options.since;
      result = result.filter((entry) => entry.timestamp >= since);
    }

    return result;
  }

  /**
   * Get all items in chronological order.
   */
  getAll(): RingBufferEntry<T>[] {
    const result: RingBufferEntry<T>[] = [];

    if (!this.isFull) {
      // Buffer not yet full, items are in order from 0 to writeIndex-1
      for (let i = 0; i < this.writeIndex; i++) {
        const entry = this.entries[i];
        if (entry !== undefined) {
          result.push(entry);
        }
      }
    } else {
      // Buffer is full, items wrap around
      // Start from writeIndex (oldest) and go to writeIndex-1 (newest)
      for (let i = 0; i < this.capacity; i++) {
        const idx = (this.writeIndex + i) % this.capacity;
        const entry = this.entries[idx];
        if (entry !== undefined) {
          result.push(entry);
        }
      }
    }

    return result;
  }

  /**
   * Clear all entries from the buffer.
   */
  clear(): void {
    this.entries = new Array<RingBufferEntry<T>>(this.capacity);
    this.writeIndex = 0;
    this.isFull = false;
  }

  /**
   * Get the current number of items in the buffer.
   */
  get size(): number {
    return this.isFull ? this.capacity : this.writeIndex;
  }
}
