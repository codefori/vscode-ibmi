import crypto from "crypto";
import path from "path";
import IBMi from "../IBMi";
import { Tools } from "../Tools";

const SERVER_ROOT = path.posix.join(`/`, `etc`, `vscode`);

function hashContent(content: string | Buffer) {
  return crypto.createHash(`sha256`).update(content).digest(`hex`);
}

/**
 * @returns a hash of `value` which only changes when its content does (key order and undefined values are ignored)
 */
export function hashObject(value: any) {
  return hashContent(stableStringify(value));
}

function stableStringify(value: any): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(`,`)}]`;
  }
  else if (value && typeof value === `object`) {
    return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(`,`)}}`;
  }
  else {
    return JSON.stringify(value) ?? `null`;
  }
}

/**
 * Thrown when an entry of a server file was changed (or deleted, or created) by someone else since the file was last loaded
 */
export class ConfigConflictError extends Error { }

/** The steps of {@link ConfigFile.update}, in order */
export type ConfigFileUpdateStep = `access` | `read` | `upload` | `verify` | `write` | `check`;

type ConfigResult = `not_loaded` | `no_exist` | `failed_to_parse` | `invalid` | `ok`;

export class ConfigFile<T> {
  private state: ConfigResult = `not_loaded`;
  private basename: string;
  private serverFile: string;
  private serverData: T | undefined;
  private serverHash: string | undefined;
  /** Why the file could not be used, when it is `failed_to_parse` or `invalid` */
  private stateError: string | undefined;

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
    this.stateError = undefined;

    const content = this.connection.getContent();
    const isAvailable = await content.testStreamFile(this.serverFile, `r`);
    if (isAvailable) {
      const fileContent = await content.downloadStreamfileRaw(this.serverFile);
      this.serverHash = hashContent(fileContent);
      try {
        // An empty file holds nothing that could be lost: it is just like a file with no configuration in it
        const rawContent = fileContent.toString();
        const serverConfig: T = rawContent.trim() ? JSON.parse(rawContent) : structuredClone(this.fallback);
        this.state = `ok`;

        if (this.validateData) {
          try {
            this.serverData = this.validateData(serverConfig);
          } catch (e: any) {
            this.state = `invalid`;
            this.stateError = String(e?.message || e);
            this.serverData = undefined;
          }
        } else {
          this.serverData = serverConfig;
        }
      } catch (e: any) {
        this.state = `failed_to_parse`;
        this.stateError = String(e?.message || e);
      }
    }
  }

  /**
   * Applies `modify` to the latest content of the server file and writes the result back.
   *
   * The file is read again right before being written, so changes made by others since it was last loaded are never lost:
   * `modify` is told when this happened, so it can decide whether its own change still applies.
   *
   * @param onProgress called when each step starts, so it can be reported (it can take a while)
   * @throws an Error if the file cannot be written, or if it cannot be parsed (it is then left untouched)
   */
  async update(modify: (current: T, changedOnServer: boolean) => T, onProgress?: (step: ConfigFileUpdateStep) => void) {
    onProgress?.(`access`);
    const accessError = await this.checkWriteAccess();
    if (accessError) {
      throw new Error(accessError);
    }

    const loadedHash = this.serverHash;
    onProgress?.(`read`);
    await this.loadFromServer();

    if (this.state === `failed_to_parse` || this.state === `invalid`) {
      throw new Error(`${this.serverFile} is not valid and won't be overwritten; fix or remove it first.${this.stateError ? ` ${this.stateError}` : ``}`);
    }

    const changedOnServer = this.serverHash !== loadedHash;
    const newData = modify(structuredClone(this.serverData ?? this.fallback), changedOnServer);

    onProgress?.(`upload`);
    const content = this.connection.getContent();
    const attr = this.connection.remoteFeatures.attr;
    const file = Tools.escapePath(this.serverFile, true);
    if (this.state === `no_exist`) {
      if (await content.testStreamFile(this.serverFile, `e`)) {
        throw new Error(`${this.serverFile} exists but cannot be read; it won't be overwritten.`);
      }

      // Everyone reads, the owner writes; same as the shared snippets. Sys admins can fine tune afterwards.
      const directory = Tools.escapePath(SERVER_ROOT, true);
      const result = await this.connection.sendCommand({ command: `test -d "${directory}" || (mkdir -p "${directory}" && chmod 755 "${directory}")` });
      if (result.code !== 0) {
        throw new Error(`Could not create ${SERVER_ROOT}: ${result.stderr.trim()}`);
      }

      // Created as UTF-8 like the shared snippets files, so its content is never converted when written
      await content.createStreamFile(this.serverFile);
      await this.connection.sendCommand({ command: `chmod 644 "${file}"` });
    }

    // Uploaded to a temporary file and checked first, so the server file only ever gets replaced by complete content
    const newContent = JSON.stringify(newData, null, 4);
    const tempFile = path.posix.join(this.connection.getTempDirectory(), `vscodetemp-${Tools.makeid()}`);
    const temp = Tools.escapePath(tempFile, true);
    try {
      await content.createStreamFile(tempFile);
      await content.writeStreamfileRaw(tempFile, newContent);
      onProgress?.(`verify`);
      if ((await content.downloadStreamfileRaw(tempFile)).toString() !== newContent) {
        throw new Error(`Could not write ${this.serverFile}: the new content could not be uploaded completely.`);
      }

      onProgress?.(`write`);
      // The content is copied as UTF-8: the file must be tagged accordingly (only done now, when it is about to be replaced)
      if (attr) {
        const ccsid = await this.connection.sendCommand({ command: `${attr} "${file}" CCSID` });
        if (ccsid.code === 0 && ccsid.stdout.trim() !== `1208`) {
          const retag = await this.connection.sendCommand({ command: `${attr} "${file}" CCSID=1208` });
          if (retag.code !== 0) {
            throw new Error(`Could not set ${this.serverFile} CCSID to 1208: ${retag.stderr.trim()}`);
          }
        }
      }

      const copy = await this.connection.sendCommand({ command: `cat "${temp}" > "${file}"` });
      if (copy.code !== 0) {
        throw new Error(`Could not write ${this.serverFile}: ${copy.stderr.trim()}`);
      }
    }
    finally {
      await this.connection.sendCommand({ command: `rm -f "${temp}"` });
    }

    onProgress?.(`check`);
    await this.loadFromServer();
    if (this.serverHash !== hashContent(newContent)) {
      throw new Error(`${this.serverFile} doesn't hold the expected content after being written; check it before saving again.`);
    }
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
    this.stateError = undefined;
    this.state = `not_loaded`;
  }

  getState() {
    return this.state;
  }

  /**
   * @returns why the file could not be used, when its state is `failed_to_parse` or `invalid`
   */
  getStateError() {
    return this.stateError;
  }
}
