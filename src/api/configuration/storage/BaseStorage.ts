export abstract class BaseStorage {
  protected readonly globalState: any;

  constructor(globalState: any) {  
    this.globalState = globalState;  
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
  constructor() {  
    super(new Map<string, any>());  
  }  
}  