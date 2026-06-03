"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConnectionStorage = void 0;
const PREVIOUS_CUR_LIBS_KEY = `prevCurLibs`;
const LAST_PROFILE_KEY = `currentProfile`;
const SOURCE_LIST_KEY = `sourceList`;
const DEPLOYMENT_KEY = `deployment`;
const DEBUG_KEY = `debug`;
const MESSAGE_SHOWN_KEY = `messageShown`;
const RECENTLY_OPENED_FILES_KEY = `recentlyOpenedFiles`;
const AUTHORISED_EXTENSIONS_KEY = `authorisedExtensions`;
class ConnectionStorage {
    internalStorage;
    connectionName;
    constructor(internalStorage) {
        this.internalStorage = internalStorage;
    }
    get ready() {
        if (this.connectionName) {
            return true;
        }
        else {
            return false;
        }
    }
    setConnectionName(connectionName) {
        this.connectionName = connectionName;
        this.internalStorage.setUniqueKeyPrefix(connectionName ? `settings-${connectionName}` : '');
    }
    getSourceList() {
        return this.internalStorage.get(SOURCE_LIST_KEY) || {};
    }
    async setSourceList(sourceList) {
        await this.internalStorage.set(SOURCE_LIST_KEY, sourceList);
    }
    getPreviousCurLibs() {
        return this.internalStorage.get(PREVIOUS_CUR_LIBS_KEY) || [];
    }
    async setPreviousCurLibs(previousCurLibs) {
        await this.internalStorage.set(PREVIOUS_CUR_LIBS_KEY, previousCurLibs);
    }
    getDeployment() {
        return this.internalStorage.get(DEPLOYMENT_KEY) || {};
    }
    async setDeployment(existingPaths) {
        await this.internalStorage.set(DEPLOYMENT_KEY, existingPaths);
    }
    getDebugCommands() {
        return this.internalStorage.get(DEBUG_KEY) || {};
    }
    setDebugCommands(existingCommands) {
        return this.internalStorage.set(DEBUG_KEY, existingCommands);
    }
    getWorkspaceDeployPath(workspaceFolderFsPath) {
        const deployDirs = this.internalStorage.get(DEPLOYMENT_KEY) || {};
        return deployDirs[workspaceFolderFsPath].toLowerCase();
    }
    getRecentlyOpenedFiles() {
        return this.internalStorage.get(RECENTLY_OPENED_FILES_KEY) || [];
    }
    async setRecentlyOpenedFiles(recentlyOpenedFiles) {
        await this.internalStorage.set(RECENTLY_OPENED_FILES_KEY, recentlyOpenedFiles);
    }
    async clearRecentlyOpenedFiles() {
        await this.internalStorage.set(RECENTLY_OPENED_FILES_KEY, undefined);
    }
    /** @deprecated stored in ConnectionSettings now */
    getLastProfile() {
        return this.internalStorage.get(LAST_PROFILE_KEY);
    }
    async clearDeprecatedLastProfile() {
        await this.internalStorage.set(LAST_PROFILE_KEY, undefined);
    }
    async grantExtensionAuthorisation(extensionId, displayName) {
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
    getExtensionAuthorisation(extensionId) {
        const authorisedExtension = this.getAuthorisedExtensions().find(authorisedExtension => authorisedExtension.id === extensionId);
        if (authorisedExtension) {
            authorisedExtension.lastAccess = new Date().getTime();
        }
        return authorisedExtension;
    }
    getAuthorisedExtensions() {
        return this.internalStorage.get(AUTHORISED_EXTENSIONS_KEY) || [];
    }
    revokeAllExtensionAuthorisations() {
        this.revokeExtensionAuthorisation(...this.getAuthorisedExtensions());
    }
    revokeExtensionAuthorisation(...extensions) {
        const newExtensions = this.getAuthorisedExtensions().filter(ext => !extensions.includes(ext));
        return this.internalStorage.set(AUTHORISED_EXTENSIONS_KEY, newExtensions);
    }
    hasMessageBeenShown(messageId) {
        const shownMessages = this.internalStorage.get(MESSAGE_SHOWN_KEY) || [];
        return shownMessages.includes(messageId);
    }
    async markMessageAsShown(messageId) {
        const shownMessages = this.internalStorage.get(MESSAGE_SHOWN_KEY) || [];
        if (!shownMessages.includes(messageId)) {
            shownMessages.push(messageId);
            await this.internalStorage.set(MESSAGE_SHOWN_KEY, shownMessages);
        }
    }
    async unmarkMessageAsShown(messageId) {
        const shownMessages = this.internalStorage.get(MESSAGE_SHOWN_KEY) || [];
        if (shownMessages.includes(messageId)) {
            await this.internalStorage.set(MESSAGE_SHOWN_KEY, shownMessages.filter(message => message !== messageId));
        }
    }
}
exports.ConnectionStorage = ConnectionStorage;
//# sourceMappingURL=ConnectionStorage.js.map