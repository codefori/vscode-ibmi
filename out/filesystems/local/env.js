"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBranchLibraryName = exports.getEnvConfig = void 0;
const path = __importStar(require("path"));
const vscode_1 = require("vscode");
const crc32c_1 = require("crc-32/crc32c");
async function envExists(currentWorkspace) {
    const folderUri = currentWorkspace.uri;
    const envUri = folderUri.with({ path: path.join(folderUri.fsPath, `.env`) });
    try {
        await vscode_1.workspace.fs.stat(envUri);
        return true;
    }
    catch (err) {
        return false;
    }
}
async function getEnvConfig(currentWorkspace) {
    const env = {};
    if (await envExists(currentWorkspace)) {
        const folderUri = currentWorkspace.uri;
        let readData, readStr;
        // Then we get the local .env file
        const envUri = folderUri.with({ path: path.join(folderUri.fsPath, `.env`) });
        readData = await vscode_1.workspace.fs.readFile(envUri);
        readStr = Buffer.from(readData).toString(`utf8`);
        const envLines = readStr.replace(new RegExp(`\\\r`, `g`), ``).split(`\n`);
        // Parse out the env lines
        envLines.forEach(line => {
            if (!line.startsWith(`#`)) {
                const [key, value] = line.split(`=`);
                if (key.length > 0 && value.length > 0) {
                    env[key.trim()] = value.trim();
                }
            }
        });
    }
    return env;
}
exports.getEnvConfig = getEnvConfig;
function getBranchLibraryName(currentBranch) {
    return `VS${((0, crc32c_1.str)(currentBranch, 0) >>> 0).toString(16).toUpperCase()}`;
}
exports.getBranchLibraryName = getBranchLibraryName;
//# sourceMappingURL=env.js.map