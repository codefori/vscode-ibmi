/**
 * A common type that works for both a Map and VS Code's Memento
 */
export type GlobalState = {
  keys(): Iterable<string>;
  get<T>(key: string): T | undefined;
  update?(key: string, value: any): Thenable<void>;
  set?(key: string, value: any): void;
}

export class BaseStorage {
  protected readonly globalState: GlobalState;

  private uniqueKeyPrefix?: string;

  constructor(globalState: GlobalState) {
    this.globalState = globalState;
  }

  keys(): readonly string[] {
    return Array.from(this.globalState.keys());
  }

  setUniqueKeyPrefix(prefix: string) {
    this.uniqueKeyPrefix = prefix;
  }

  get<T>(key: string): T | undefined {
    return this.globalState.get(this.getStorageKey(key)) as T | undefined;
  }

  async set(key: string, value: any) {
    if (this.globalState.set) {
      this.globalState.set(this.getStorageKey(key), value);
    }
    else if (this.globalState.update) {
      await this.globalState.update(this.getStorageKey(key), value);
    }
  }

  getStorageKey(key: string): string {
    return `${this.uniqueKeyPrefix ? this.uniqueKeyPrefix + '.' : ''}${key}`;
  }
}