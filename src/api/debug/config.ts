import { instance } from "../../instantiate";

type ConfigLine = {
  key: string
  value?: string
}

export class DebugConfiguration {
  readonly configLines: ConfigLine[] = [];

  constructor(readonly envFile: string) {

  }

  private getContent() {
    const content = instance.getContent();
    if (!content) {
      throw new Error("Not connected to an IBM i");
    }

    return content;
  }

  getOrDefault(key: string, defaultValue: string) {
    return this.get(key) || defaultValue;
  }

  get(key: string) {
    return this.configLines.find(line => line.key === key && line.value !== undefined)?.value;
  }

  set(key: string, value: string) {
    let config = this.configLines.find(line => line.key === key && line.value !== undefined);
    if (config) {
      config.value = value;
    }
    else {
      this.configLines.push({ key, value });
    }
  }

  async load() {
    const content = (await this.getContent().downloadStreamfileRaw(this.envFile)).toString("utf-8");
    this.configLines.push(...content.split("\n")
      .map(line => line.trim())
      .map(line => {
        const equalPos = line.indexOf("=");
        if (!line || line.startsWith("#") || equalPos === -1) {
          return { key: line };
        }
        else {
          return {
            key: line.substring(0, equalPos),
            value: equalPos < line.length ? line.substring(equalPos + 1) : ''
          }
        }
      })
    );
  }

  async save() {
    await this.getContent().writeStreamfileRaw(this.envFile, Buffer.from(this.configLines.map(line => `${line.key}${line.value !== undefined ? `=${line.value}` : ''}`).join("\n"), `utf8`));
  }
}