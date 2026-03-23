import { RingBuffer } from './ring-buffer.js';

export interface LogEntry {
  level: number;
  module?: string;
  msg: string;
  timestamp: number;
}

const DEFAULT_LOG_BUFFER_CAPACITY = 1000;

export class LogRingBuffer {
  private readonly buffer: RingBuffer<LogEntry>;

  constructor(capacity: number = DEFAULT_LOG_BUFFER_CAPACITY) {
    this.buffer = new RingBuffer<LogEntry>(capacity);
  }

  push(entry: LogEntry): void {
    this.buffer.push(entry);
  }

  getRecent(limit: number): LogEntry[] {
    return this.buffer.getRecent(limit).map((entry) => entry.data);
  }

  getByLevel(minLevel: number): LogEntry[] {
    return this.buffer
      .getAll()
      .map((entry) => entry.data)
      .filter((entry) => entry.level >= minLevel);
  }

  getByModule(module: string): LogEntry[] {
    return this.buffer
      .getAll()
      .map((entry) => entry.data)
      .filter((entry) => entry.module === module);
  }

  get size(): number {
    return this.buffer.size;
  }

  clear(): void {
    this.buffer.clear();
  }
}

let singletonLogBuffer: LogRingBuffer | undefined;

export function getLogBuffer(): LogRingBuffer {
  if (singletonLogBuffer === undefined) {
    singletonLogBuffer = new LogRingBuffer();
  }
  return singletonLogBuffer;
}
