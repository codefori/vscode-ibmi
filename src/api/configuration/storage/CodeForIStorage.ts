import { AspInfo, ConnectionData } from "../../types";
import { BaseStorage } from "./BaseStorage";
const SERVER_SETTINGS_CACHE_PREFIX = `serverSettingsCache_`;
const SERVER_SETTINGS_CACHE_KEY = (name: string) => SERVER_SETTINGS_CACHE_PREFIX + name;
const PREVIOUS_SEARCH_TERMS_KEY = `prevSearchTerms`;
const PREVIOUS_FIND_TERMS_KEY = `prevFindTerms`;

export type PathContent = Record<string, string[]>;
export type DeploymentPath = Record<string, string>;
export type DebugCommands = Record<string, string>;

export type LastConnection = {
  name: string
  timestamp: number
};

export type CachedServerSettings = {
  lastCheckedOnVersion: string | undefined;
  iAspInfo: AspInfo[];
  qccsid: number | null;
  jobCcsid: number | null
  remoteFeatures: { [name: string]: string | undefined }
  remoteFeaturesKeys: string | null
  badDataAreasChecked: boolean | null
  libraryListValidated: boolean | null
  pathChecked?: boolean
  userDefaultCCSID: number | null
  debugConfigLoaded: boolean
  maximumArgsLength: number
} | undefined;

export class CodeForIStorage {
  constructor(private internalStorage: BaseStorage) {}

  protected getStorageKey(key: string): string {
    return key;
  }

  getLastConnections() {
    return this.internalStorage.get<LastConnection[]>("lastConnections");
  }

  async setLastConnection(name: string) {
    const lastConnections = this.getLastConnections() || [];
    const connection = lastConnections?.find(c => c.name === name);
    if (connection) {
      connection.timestamp = Date.now();
    }
    else {
      lastConnections?.push({ name, timestamp: Date.now() });
    }
    await this.setLastConnections(lastConnections);
  }

  async setLastConnections(lastConnections: LastConnection[]) {
    await this.internalStorage.set("lastConnections", lastConnections.sort((c1, c2) => c2.timestamp - c1.timestamp));
  }

  getServerSettingsCache(name: string) {
    return this.internalStorage.get<CachedServerSettings|undefined>(SERVER_SETTINGS_CACHE_KEY(name));
  }

  async setServerSettingsCache(name: string, serverSettings: CachedServerSettings) {
    await this.internalStorage.set(SERVER_SETTINGS_CACHE_KEY(name), serverSettings);
  }

  async setServerSettingsCacheSpecific(name: string, newSettings: Partial<CachedServerSettings>) {
    await this.internalStorage.set(SERVER_SETTINGS_CACHE_KEY(name), {
      ...this.getServerSettingsCache(name),
      ...newSettings
    });
  }

  async deleteServerSettingsCache(name: string) {
    await this.internalStorage.set(SERVER_SETTINGS_CACHE_KEY(name), undefined);
  }

  async deleteStaleServerSettingsCache(connections: ConnectionData[]) {
    const validKeys = connections.map(connection => SERVER_SETTINGS_CACHE_KEY(connection.name));
    const currentKeys = this.internalStorage.keys();
    const keysToDelete = currentKeys.filter(key => key.startsWith(SERVER_SETTINGS_CACHE_PREFIX) && !validKeys.includes(key));
    for await (const key of keysToDelete) {
      await this.internalStorage.set(key, undefined);
    }
  }

  getPreviousSearchTerms() {
    return this.internalStorage.get<string[]>(PREVIOUS_SEARCH_TERMS_KEY) || [];
  }

  async addPreviousSearchTerm(term: string) {    
    await this.internalStorage.set(PREVIOUS_SEARCH_TERMS_KEY, [term].concat(this.getPreviousSearchTerms().filter(t => t !== term)));
  }

  async clearPreviousSearchTerms(){
    await this.internalStorage.set(PREVIOUS_SEARCH_TERMS_KEY, undefined);
  }

  getPreviousFindTerms() {
    return this.internalStorage.get<string[]>(PREVIOUS_FIND_TERMS_KEY) || [];
  }

  async addPreviousFindTerm(term: string) {
    await this.internalStorage.set(PREVIOUS_FIND_TERMS_KEY, [term].concat(this.getPreviousFindTerms().filter(t => t !== term)));
  }

  async clearPreviousFindTerms(){
    await this.internalStorage.set(PREVIOUS_FIND_TERMS_KEY, undefined);
  }
}
