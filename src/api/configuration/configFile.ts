
import path from "path";
import IBMi from "../IBMi";

const SERVER_ROOT = path.posix.join(`/`, `etc`, `vscode`);

type ConfigResult = `not_loaded` | `no_exist` | `failed_to_parse` | `invalid` | `ok`;

export class ConfigFile<T> {
  private state: ConfigResult = `not_loaded`;
  private basename: string;
  private serverFile: string;
  private serverData: T | undefined;

  // Should throw an error if loaded config is invalid
  private validateData: ((loadedConfig: T) => T) | undefined;

  constructor(private connection: IBMi, configId: string, readonly fallback: T, validateData?: ((loadedConfig: T) => T)) {
    this.basename = configId + `.json`;
    this.serverFile = path.posix.join(SERVER_ROOT, this.basename);
    this.validateData = validateData;
  }

  getPaths() {
    return {
      server: this.serverFile,
    }
  }

  async loadFromServer() {
    this.state = `no_exist`;

    const isAvailable = await this.connection.getContent().testStreamFile(this.serverFile, `r`);
    if (isAvailable) {
      const content = await this.connection.getContent().downloadStreamfileRaw(this.serverFile);
      try {
        const serverConfig: T = JSON.parse(content.toString());
        this.state = `ok`;

        if (this.validateData) {
          try {
            this.serverData = this.validateData(serverConfig);
          } catch (e) {
            this.state = `invalid`;
            this.serverData = undefined;
          }
        } else {
          this.serverData = serverConfig;
        }
      } catch (e: any) {
        this.state = `failed_to_parse`;
      }
    }
  }

  async writeToServer(newConfig: T): Promise<boolean> {
    try {
      const content = this.connection.getContent();
      if (this.state === `no_exist`) {
        await content.createStreamFile(this.serverFile);
      }

      content.writeStreamfileRaw(this.serverFile, JSON.stringify(newConfig, null, 4));
      await this.loadFromServer();
      return true;
    } catch (e: any) {
      return false;
    }
  }

  async get() {
    return this.serverData || this.fallback;
  }

  reset() {
    this.serverData = undefined;
    this.state = `not_loaded`;
  }

  getState() {
    return this.state;
  }
}