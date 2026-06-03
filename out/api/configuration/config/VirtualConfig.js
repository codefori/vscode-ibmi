"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VirtualConfig = exports.Config = void 0;
class Config {
}
exports.Config = Config;
class VirtualConfig extends Config {
    config = new Map();
    get(key) {
        return this.config.get(key);
    }
    async set(key, value) {
        this.config.set(key, value);
    }
}
exports.VirtualConfig = VirtualConfig;
//# sourceMappingURL=VirtualConfig.js.map