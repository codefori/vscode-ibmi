"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigFile = void 0;
const path_1 = __importDefault(require("path"));
const WORKSPACE_ROOT = `.vscode`;
const SERVER_ROOT = path_1.default.posix.join(`/`, `etc`, `vscode`);
class ConfigFile {
    connection;
    fallback;
    state = `not_loaded`;
    basename;
    serverFile;
    serverData;
    validateData;
    constructor(connection, configId, fallback) {
        this.connection = connection;
        this.fallback = fallback;
        this.basename = configId + `.json`;
        this.serverFile = path_1.default.posix.join(SERVER_ROOT, this.basename);
    }
    getPaths() {
        return {
            server: this.serverFile,
        };
    }
    async loadFromServer() {
        let serverConfig;
        this.state = `no_exist`;
        const isAvailable = await this.connection.getContent().testStreamFile(this.serverFile, `r`);
        if (isAvailable) {
            const content = await this.connection.getContent().downloadStreamfileRaw(this.serverFile);
            try {
                serverConfig = JSON.parse(content.toString());
                this.state = `ok`;
            }
            catch (e) {
                this.state = `failed_to_parse`;
            }
            if (this.validateData) {
                // Should throw an error.
                try {
                    this.serverData = this.validateData(serverConfig);
                }
                catch (e) {
                    this.state = `invalid`;
                    this.serverData = undefined;
                }
            }
            else {
                this.serverData = serverConfig;
            }
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
exports.ConfigFile = ConfigFile;
//# sourceMappingURL=serverFile.js.map