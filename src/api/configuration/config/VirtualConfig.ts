export abstract class Config {
  abstract get<T>(key: string): T | undefined;

  abstract set(key: string, value: any): Promise<void>;
}

export class VirtualConfig extends Config {
  private readonly config: Map<string, any> = new Map();

  get<T>(key: string): T | undefined {
    return this.config.get(key) as T | undefined;
  }

  async set(key: string, value: any): Promise<void> {
    this.config.set(key, value);
  }
}