"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseStorage = void 0;
class BaseStorage {
    globalState;
    uniqueKeyPrefix;
    constructor(globalState) {
        this.globalState = globalState;
    }
    keys() {
        return Array.from(this.globalState.keys());
    }
    setUniqueKeyPrefix(prefix) {
        this.uniqueKeyPrefix = prefix;
    }
    get(key) {
        return this.globalState.get(this.getStorageKey(key));
    }
    async set(key, value) {
        if (this.globalState.set) {
            this.globalState.set(this.getStorageKey(key), value);
        }
        else if (this.globalState.update) {
            await this.globalState.update(this.getStorageKey(key), value);
        }
    }
    getStorageKey(key) {
        return `${this.uniqueKeyPrefix ? this.uniqueKeyPrefix + '.' : ''}${key}`;
    }
}
exports.BaseStorage = BaseStorage;
//# sourceMappingURL=BaseStorage.js.map