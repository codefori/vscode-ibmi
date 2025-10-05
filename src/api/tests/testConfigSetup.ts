import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { Config } from "../configuration/config/VirtualConfig";
import { BaseStorage } from "../configuration/storage/BaseStorage";

class JSONMap extends Map<string, any> {

  constructor(private readonly filePath: string) {
    if (existsSync(filePath)) {
      const data = JSON.parse(readFileSync(filePath).toString("utf-8"));
      super(Object.entries(data));
    }
    else {
      super();
    }
  }

  save() {
    return writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this), null, 2));
  }
}

export class JSONConfig extends Config {
  private readonly config: JSONMap = new JSONMap(path.join(__dirname, `.config.json`));

  public save() {
    this.config.save();
  }

  get<T>(key: string): T | undefined {
    return this.config.get(key) as T | undefined;
  }

  async set(key: string, value: any): Promise<void> {
    this.config.set(key, value);
  }
}

export class JsonStorage extends BaseStorage {
  private readonly config: JSONMap;

  constructor() {
    const jsonMap = new JSONMap(path.join(__dirname, `.storage.json`));
    super(jsonMap);
    this.config = jsonMap;
  }

  public save() {
    this.config.save();
  }
}