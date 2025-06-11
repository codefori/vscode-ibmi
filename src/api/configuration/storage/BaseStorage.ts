export abstract class BaseStorage {
  protected readonly globalState: any;

  private uniqueKeyPrefix: string|undefined;
  constructor(globalState: any) {  
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
    await this.globalState.set(this.getStorageKey(key), value);
  }

  getStorageKey(key: string): string {
    return `${this.uniqueKeyPrefix ? this.uniqueKeyPrefix + '.' : ''}${key}`;
  }
}

export class VirtualStorage extends BaseStorage {  
  constructor() {  
    super(new Map<string, any>());  
  }  
}  