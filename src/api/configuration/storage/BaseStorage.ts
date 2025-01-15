export abstract class BaseStorage {
  protected readonly globalState: any;

  constructor() {
    this.globalState = new Map<string, any>();
  }

  keys(): readonly string[] {
    return Array.from(this.globalState.keys());
  }

  get<T>(key: string): T | undefined {
    return this.globalState.get(this.getStorageKey(key)) as T | undefined;
  }

  async set(key: string, value: any) {
    await this.globalState.set(this.getStorageKey(key), value);
  }

  getStorageKey(key: string): string {
    return key;
  }
}

export class VirtualStorage extends BaseStorage {
  protected readonly globalState: Map<string, any> = new Map<string, any>();

  constructor() {
    super();
  }
}