"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeForIStorage = void 0;
const SERVER_SETTINGS_CACHE_PREFIX = `serverSettingsCache_`;
const SERVER_SETTINGS_CACHE_KEY = (name) => SERVER_SETTINGS_CACHE_PREFIX + name;
const PREVIOUS_SEARCH_TERMS_KEY = `prevSearchTerms`;
const PREVIOUS_FIND_TERMS_KEY = `prevFindTerms`;
class CodeForIStorage {
    internalStorage;
    constructor(internalStorage) {
        this.internalStorage = internalStorage;
    }
    getLastConnections() {
        return this.internalStorage.get("lastConnections");
    }
    async setLastConnection(name) {
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
    async setLastConnections(lastConnections) {
        await this.internalStorage.set("lastConnections", lastConnections.sort((c1, c2) => c2.timestamp - c1.timestamp));
    }
    getServerSettingsCache(name) {
        return this.internalStorage.get(SERVER_SETTINGS_CACHE_KEY(name));
    }
    async setServerSettingsCache(name, serverSettings) {
        await this.internalStorage.set(SERVER_SETTINGS_CACHE_KEY(name), serverSettings);
    }
    async setServerSettingsCacheSpecific(name, newSettings) {
        await this.internalStorage.set(SERVER_SETTINGS_CACHE_KEY(name), {
            ...this.getServerSettingsCache(name),
            ...newSettings
        });
    }
    async storeComponentState(connectionName, component) {
        const existingSettings = this.getServerSettingsCache(connectionName);
        if (!existingSettings) {
            return;
        }
        const componentCache = existingSettings.installedComponents;
        const stateId = componentCache.findIndex(c => c.id.name === component.id.name);
        if (stateId >= 0) {
            if (component.state === `Installed`) {
                componentCache[stateId] = component;
            }
            else {
                componentCache.splice(stateId, 1);
            }
        }
        else {
            if (component.state === `Installed`) {
                componentCache.push(component);
            }
        }
        await this.setServerSettingsCache(connectionName, {
            ...existingSettings,
            installedComponents: componentCache
        });
    }
    async deleteServerSettingsCache(name) {
        await this.internalStorage.set(SERVER_SETTINGS_CACHE_KEY(name), undefined);
    }
    async deleteStaleServerSettingsCache(connections) {
        const validKeys = connections.map(connection => SERVER_SETTINGS_CACHE_KEY(connection.name));
        const currentKeys = this.internalStorage.keys();
        const keysToDelete = currentKeys.filter(key => key.startsWith(SERVER_SETTINGS_CACHE_PREFIX) && !validKeys.includes(key));
        for await (const key of keysToDelete) {
            await this.internalStorage.set(key, undefined);
        }
    }
    getPreviousSearchTerms() {
        return this.internalStorage.get(PREVIOUS_SEARCH_TERMS_KEY) || [];
    }
    async addPreviousSearchTerm(term) {
        await this.internalStorage.set(PREVIOUS_SEARCH_TERMS_KEY, [term].concat(this.getPreviousSearchTerms().filter(t => t !== term)));
    }
    async clearPreviousSearchTerms() {
        await this.internalStorage.set(PREVIOUS_SEARCH_TERMS_KEY, undefined);
    }
    getPreviousFindTerms() {
        return this.internalStorage.get(PREVIOUS_FIND_TERMS_KEY) || [];
    }
    async addPreviousFindTerm(term) {
        await this.internalStorage.set(PREVIOUS_FIND_TERMS_KEY, [term].concat(this.getPreviousFindTerms().filter(t => t !== term)));
    }
    async clearPreviousFindTerms() {
        await this.internalStorage.set(PREVIOUS_FIND_TERMS_KEY, undefined);
    }
}
exports.CodeForIStorage = CodeForIStorage;
//# sourceMappingURL=CodeForIStorage.js.map