"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomCLI = void 0;
const path_1 = __importDefault(require("path"));
class CustomCLI {
    static ID = "customCli";
    installPath = "";
    getIdentification() {
        return { name: CustomCLI.ID, version: 1, userManaged: true };
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
        const result = await connection.getContent().testStreamFile(this.installPath, "r");
        if (!result) {
            return `NotInstalled`;
        }
        const testResult = await connection.getContent().testStreamFile(this.installPath, "r");
        if (!testResult) {
            return `Error`;
        }
        return `Installed`;
    }
    async update(connection) {
        await connection.getContent().writeStreamfileRaw(this.installPath, JSON.stringify(this.getIdentification()));
        return `Installed`;
    }
    async uninstall(connection) {
        await connection.sendCommand({ command: `rm ${this.installPath}` });
    }
}
exports.CustomCLI = CustomCLI;
//# sourceMappingURL=customCli.js.map