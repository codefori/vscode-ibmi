import crypto from "crypto";
import path from "path";
import IBMi from "../IBMi";
import { Tools } from "../Tools";

const SERVER_ROOT = path.posix.join(`/`, `etc`, `vscode`);

type ConfigResult = `not_loaded` | `no_exist` | `failed_to_parse` | `invalid` | `ok`;

export class ConfigFile<T> {
  private state: ConfigResult = `not_loaded`;
  private basename: string;
  private serverFile: string;
  private serverData: T | undefined;
  private serverHash: string | undefined;

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
    this.serverData = undefined;
    this.serverHash = undefined;

    const content = this.connection.getContent();
    const isAvailable = await content.testStreamFile(this.serverFile, `r`);
    if (isAvailable) {
      const fileContent = await content.downloadStreamfileRaw(this.serverFile);
      this.serverHash = crypto.createHash(`sha256`).update(fileContent).digest(`hex`);
      try {
        const serverConfig: T = JSON.parse(fileContent.toString());
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

  /**
   * Applies `modify` to the latest content of the server file and writes the result back.
   *
   * The file is read again right before being written, so changes made by others since it was last loaded are never lost:
   * `modify` is told when this happened, so it can decide whether its own change still applies.
   *
   * @throws an Error if the file cannot be written, or if it cannot be parsed (it is then left untouched)
   */
  async update(modify: (current: T, changedOnServer: boolean) => T) {
    const accessError = await this.checkWriteAccess();
    if (accessError) {
      throw new Error(accessError);
    }

    const loadedHash = this.serverHash;
    await this.loadFromServer();

    if (this.state === `failed_to_parse` || this.state === `invalid`) {
      throw new Error(`${this.serverFile} is not valid and won't be overwritten; fix or remove it first.`);
    }

    const changedOnServer = this.serverHash !== loadedHash;
    const newData = modify(structuredClone(this.serverData ?? this.fallback), changedOnServer);

    const content = this.connection.getContent();
    if (this.state === `no_exist`) {
      if (await content.testStreamFile(this.serverFile, `e`)) {
        throw new Error(`${this.serverFile} exists but cannot be read; it won't be overwritten.`);
      }

      // Everyone reads, the owner writes; same as the shared snippets. Sys admins can fine tune afterwards.
      const directory = Tools.escapePath(SERVER_ROOT, true);
      const file = Tools.escapePath(this.serverFile, true);
      const result = await this.connection.sendCommand({ command: `(test -d "${directory}" || (mkdir -p "${directory}" && chmod 755 "${directory}")) && touch "${file}" && chmod 644 "${file}"` });
      if (result.code !== 0) {
        throw new Error(`Could not create ${this.serverFile}: ${result.stderr.trim()}`);
      }
    }

    await content.writeStreamfileRaw(this.serverFile, JSON.stringify(newData, null, 4));
    await this.loadFromServer();
  }

  /**
   * @returns why the server file cannot be written, or `undefined` if it can
   */
  async checkWriteAccess(): Promise<string | undefined> {
    const content = this.connection.getContent();
    if (await content.testStreamFile(this.serverFile, `e`)) {
      if (!await content.testStreamFile(this.serverFile, `w`)) {
        return `You don't have the rights to write into ${this.serverFile}.`;
      }
    }
    else if (await content.testStreamFile(SERVER_ROOT, `d`)) {
      if (!await content.testStreamFile(SERVER_ROOT, `w`)) {
        return `You are not allowed to create ${this.serverFile}; ask your system administrator to grant you write access to ${SERVER_ROOT}.`;
      }
    }
    else if (!await content.testStreamFile(path.posix.dirname(SERVER_ROOT), `w`)) {
      return `You are not allowed to create ${SERVER_ROOT}; ask your system administrator to grant you write access to ${path.posix.dirname(SERVER_ROOT)}.`;
    }
  }

  async get() {
    return this.serverData || this.fallback;
  }

  reset() {
    this.serverData = undefined;
    this.serverHash = undefined;
    this.state = `not_loaded`;
  }

  getState() {
    return this.state;
  }
}
