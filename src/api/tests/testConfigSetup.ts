import path from "path";
import { Config } from "../configuration/config/VirtualConfig";
import { writeFile } from "fs/promises";
import { existsSync } from "fs";
import { BaseStorage } from "../configuration/storage/BaseStorage";

const configPath = path.join(__dirname, `config.json`);
const storagePath = path.join(__dirname, `storage.json`);

export class JsonConfig extends Config {
  private readonly config: Map<string, any> = new Map();

  public async load() {
    if (existsSync(configPath)) {
      const data = await import(configPath);
      for (const key in data) {
        this.config.set(key, data[key]);
      }
    }
  }

  public save() {
    const data: any = {};

    Array.from(this.config.keys()).forEach(key => data[key] = this.config.get(key));
    data.default = undefined;
    
    return writeFile(configPath, JSON.stringify(data, null, 2));
  }

  get<T>(key: string): T | undefined {
    return this.config.get(key) as T | undefined;
  }

  async set(key: string, value: any): Promise<void> {
    this.config.set(key, value);
  }
}

export class JsonStorage extends BaseStorage {
  protected readonly globalState: Map<string, any>;

  constructor() {
    const newState = new Map<string, any>()
    super(newState);
    
    this.globalState = newState;
  }

  exists() {
    return existsSync(storagePath);
  }

  public async load() {
    if (this.exists()) {
      const data = await import(storagePath);
      for (const key in data) {
        this.globalState.set(key, data[key]);
      }
    }
  }

  public save() {
    const data: any = {};

    Array.from(this.globalState.keys()).forEach(key => data[key] = this.globalState.get(key));
    data.default = undefined;
    
    return writeFile(storagePath, JSON.stringify(data, null, 2));
  }
}