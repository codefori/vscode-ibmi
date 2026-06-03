"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JsonStorage = exports.JSONConfig = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const VirtualConfig_1 = require("../configuration/config/VirtualConfig");
const BaseStorage_1 = require("../configuration/storage/BaseStorage");
class JSONMap extends Map {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
        if ((0, fs_1.existsSync)(filePath)) {
            const data = JSON.parse((0, fs_1.readFileSync)(filePath).toString("utf-8"));
            super(Object.entries(data));
        }
        else {
            super();
        }
    }
    save() {
        return (0, fs_1.writeFileSync)(this.filePath, JSON.stringify(Object.fromEntries(this), null, 2));
    }
}
class JSONConfig extends VirtualConfig_1.Config {
    config = new JSONMap(path_1.default.join(__dirname, `.config.json`));
    save() {
        this.config.save();
    }
    get(key) {
        return this.config.get(key);
    }
    async set(key, value) {
        this.config.set(key, value);
    }
}
exports.JSONConfig = JSONConfig;
class JsonStorage extends BaseStorage_1.BaseStorage {
    config;
    constructor() {
        const jsonMap = new JSONMap(path_1.default.join(__dirname, `.storage.json`));
        super(jsonMap);
        this.config = jsonMap;
    }
    save() {
        this.config.save();
    }
}
exports.JsonStorage = JsonStorage;
//# sourceMappingURL=testConfigSetup.js.map