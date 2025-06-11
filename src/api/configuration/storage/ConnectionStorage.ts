import { BaseStorage } from "./BaseStorage";
import { PathContent, DeploymentPath, DebugCommands } from "./CodeForIStorage";

const PREVIOUS_CUR_LIBS_KEY = `prevCurLibs`;
const LAST_PROFILE_KEY = `currentProfile`;
const SOURCE_LIST_KEY = `sourceList`;
const DEPLOYMENT_KEY = `deployment`;
const DEBUG_KEY = `debug`;
const MESSAGE_SHOWN_KEY = `messageShown`;

const RECENTLY_OPENED_FILES_KEY = `recentlyOpenedFiles`;
const AUTHORISED_EXTENSIONS_KEY = `authorisedExtensions`

type AuthorisedExtension = {
  id: string
  displayName: string
  since: number
  lastAccess: number
}

export class ConnectionStorage {
  private connectionName: string = "";
  constructor(private internalStorage: BaseStorage) {
  }

  get ready(): boolean {
    if (this.connectionName) {
      return true;
    }
    else {
      return false;
    }
  }

  setConnectionName(connectionName: string) {
    this.connectionName = connectionName;
    this.internalStorage.setUniqueKeyPrefix(`settings-${connectionName}`);
  }

  getSourceList() {
    return this.internalStorage.get<PathContent>(SOURCE_LIST_KEY) || {};
  }

  async setSourceList(sourceList: PathContent) {
    await this.internalStorage.set(SOURCE_LIST_KEY, sourceList);
  }

  getLastProfile() {
    return this.internalStorage.get<string>(LAST_PROFILE_KEY);
  }

  async setLastProfile(lastProfile: string) {
    await this.internalStorage.set(LAST_PROFILE_KEY, lastProfile);
  }

  getPreviousCurLibs() {
    return this.internalStorage.get<string[]>(PREVIOUS_CUR_LIBS_KEY) || [];
  }

  async setPreviousCurLibs(previousCurLibs: string[]) {
    await this.internalStorage.set(PREVIOUS_CUR_LIBS_KEY, previousCurLibs);
  }

  getDeployment() {
    return this.internalStorage.get<DeploymentPath>(DEPLOYMENT_KEY) || {};
  }

  async setDeployment(existingPaths: DeploymentPath) {
    await this.internalStorage.set(DEPLOYMENT_KEY, existingPaths);
  }

  getDebugCommands() {
    return this.internalStorage.get<DebugCommands>(DEBUG_KEY) || {};
  }

  setDebugCommands(existingCommands: DebugCommands) {
    return this.internalStorage.set(DEBUG_KEY, existingCommands);
  }

  getWorkspaceDeployPath(workspaceFolderFsPath: string) {
    const deployDirs = this.internalStorage.get<DeploymentPath>(DEPLOYMENT_KEY) || {};
    return deployDirs[workspaceFolderFsPath].toLowerCase();
  }

  getRecentlyOpenedFiles() {
    return this.internalStorage.get<string[]>(RECENTLY_OPENED_FILES_KEY) || [];
  }

  async setRecentlyOpenedFiles(recentlyOpenedFiles: string[]) {
    await this.internalStorage.set(RECENTLY_OPENED_FILES_KEY, recentlyOpenedFiles);
  }

  async clearRecentlyOpenedFiles() {
    await this.internalStorage.set(RECENTLY_OPENED_FILES_KEY, undefined);
  }

  async grantExtensionAuthorisation(extensionId: string, displayName: string) {
    const extensions = this.getAuthorisedExtensions();
    if (!this.getExtensionAuthorisation(extensionId)) {
      extensions.push({
        id: extensionId,
        displayName: displayName,
        since: new Date().getTime(),
        lastAccess: new Date().getTime()
      });
      await this.internalStorage.set(AUTHORISED_EXTENSIONS_KEY, extensions);
    }
  }

  getExtensionAuthorisation(extensionId: string) {
    const authorisedExtension = this.getAuthorisedExtensions().find(authorisedExtension => authorisedExtension.id === extensionId);
    if (authorisedExtension) {
      authorisedExtension.lastAccess = new Date().getTime();
    }
    return authorisedExtension;
  }

  getAuthorisedExtensions(): AuthorisedExtension[] {
    return this.internalStorage.get<AuthorisedExtension[]>(AUTHORISED_EXTENSIONS_KEY) || [];
  }

  revokeAllExtensionAuthorisations() {
    this.revokeExtensionAuthorisation(...this.getAuthorisedExtensions());
  }

  revokeExtensionAuthorisation(...extensions: AuthorisedExtension[]) {
    const newExtensions = this.getAuthorisedExtensions().filter(ext => !extensions.includes(ext));
    return this.internalStorage.set(AUTHORISED_EXTENSIONS_KEY, newExtensions);
  }

  hasMessageBeenShown(messageId: string): boolean {
    const shownMessages = this.internalStorage.get<string[]>(MESSAGE_SHOWN_KEY) || [];
    return shownMessages.includes(messageId);
  }

  async markMessageAsShown(messageId: string): Promise<void> {
    const shownMessages = this.internalStorage.get<string[]>(MESSAGE_SHOWN_KEY) || [];
    if (!shownMessages.includes(messageId)) {
      shownMessages.push(messageId);
      await this.internalStorage.set(MESSAGE_SHOWN_KEY, shownMessages);
    }
  }
}
