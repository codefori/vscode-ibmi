"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomQSh = void 0;
const promises_1 = require("fs/promises");
const path_1 = __importDefault(require("path"));
class CustomQSh {
    static ID = "cqsh";
    localAssetPath;
    setLocalAssetPath(newPath) {
        this.localAssetPath = newPath;
    }
    installPath = "";
    getIdentification() {
        return { name: CustomQSh.ID, version: 1 };
    }
    getFileName() {
        const id = this.getIdentification();
        return `${id.name}_${id.version}`;
    }
    async setInstallDirectory(installDirectory) {
        this.installPath = path_1.default.posix.join(installDirectory, this.getFileName());
    }
    async getRemoteState(connection, installDirectory) {
        this.installPath = path_1.default.posix.join(installDirectory, this.getFileName());
        const result = await connection.getContent().testStreamFile(this.installPath, "x");
        if (!result) {
            return `NotInstalled`;
        }
        const testResult = await this.testCommand(connection);
        if (!testResult) {
            return `Error`;
        }
        return `Installed`;
    }
    async update(connection) {
        if (!this.localAssetPath) {
            return `Error`;
        }
        const assetExistsLocally = await exists(this.localAssetPath);
        if (!assetExistsLocally) {
            return `Error`;
        }
        await connection.getContent().uploadFiles([{ local: this.localAssetPath, remote: this.installPath }]);
        await connection.sendCommand({
            command: `chmod +x ${this.installPath}`,
        });
        const testResult = await this.testCommand(connection);
        if (!testResult) {
            return `Error`;
        }
        return `Installed`;
    }
    async testCommand(connection) {
        const text = `Hello world`;
        const result = await connection.sendCommand({
            stdin: `echo "${text}"`,
            command: this.installPath,
        });
        if (result.code !== 0 || result.stdout !== text) {
            return false;
        }
        return true;
    }
}
exports.CustomQSh = CustomQSh;
async function exists(path) {
    try {
        await (0, promises_1.stat)(path);
        return true;
    }
    catch (e) {
        return false;
    }
}
//# sourceMappingURL=index.js.map