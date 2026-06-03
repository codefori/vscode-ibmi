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
exports.VsCodeConfig = exports.onCodeForIBMiConfigurationChange = void 0;
const vscode = __importStar(require("vscode"));
const VirtualConfig_1 = require("../api/configuration/config/VirtualConfig");
function onCodeForIBMiConfigurationChange(props, todo) {
    const keys = (Array.isArray(props) ? props : Array.of(props)).map(key => `code-for-ibmi.${key}`);
    return vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (keys.some(key => event.affectsConfiguration(key))) {
            todo(event);
        }
    });
}
exports.onCodeForIBMiConfigurationChange = onCodeForIBMiConfigurationChange;
class VsCodeConfig extends VirtualConfig_1.Config {
    constructor() {
        super();
    }
    getWorkspaceConfig() {
        return vscode.workspace.getConfiguration(`code-for-ibmi`);
    }
    get(key) {
        return this.getWorkspaceConfig().get(key);
    }
    async set(key, value) {
        await this.getWorkspaceConfig().update(key, value, vscode.ConfigurationTarget.Global);
    }
}
exports.VsCodeConfig = VsCodeConfig;
//# sourceMappingURL=Configuration.js.map