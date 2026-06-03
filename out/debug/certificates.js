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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkClientCertificate = exports.getLocalCertPath = exports.downloadClientCert = exports.remoteCertificatesExists = void 0;
const fs_1 = require("fs");
const os = __importStar(require("os"));
const path_1 = __importDefault(require("path"));
const vscode_1 = __importDefault(require("vscode"));
const DebugConfiguration_1 = require("../api/configuration/DebugConfiguration");
const instantiate_1 = require("../instantiate");
async function remoteCertificatesExists(debugConfig) {
    const connection = instantiate_1.instance.getConnection();
    if (connection) {
        const content = connection.getContent();
        debugConfig = debugConfig || await new DebugConfiguration_1.DebugConfiguration(connection).load();
        return await content.testStreamFile(debugConfig.getRemoteClientCertificatePath(), "f");
    }
    else {
        throw new Error("Not connected to an IBM i");
    }
}
exports.remoteCertificatesExists = remoteCertificatesExists;
async function downloadClientCert(connection) {
    const content = connection.getContent();
    const debugConfig = await new DebugConfiguration_1.DebugConfiguration(connection).load();
    await content.downloadStreamfileRaw(debugConfig.getRemoteClientCertificatePath(), getLocalCertPath(connection));
}
exports.downloadClientCert = downloadClientCert;
function getLocalCertPath(connection) {
    const host = connection.currentHost;
    return path_1.default.join(os.homedir(), `${host}_${DebugConfiguration_1.CLIENT_CERTIFICATE}`);
}
exports.getLocalCertPath = getLocalCertPath;
async function checkClientCertificate(connection, debugConfig) {
    const locaCertificatePath = getLocalCertPath(connection);
    if ((0, fs_1.existsSync)(locaCertificatePath)) {
        debugConfig = debugConfig || await new DebugConfiguration_1.DebugConfiguration(connection).load();
        const remote = (await connection.sendCommand({ command: `cat ${debugConfig.getRemoteClientCertificatePath()}` }));
        if (!remote.code) {
            const localCertificate = (0, fs_1.readFileSync)(locaCertificatePath).toString("utf-8");
            if (localCertificate.trim() !== remote.stdout.trim()) {
                throw new Error(vscode_1.default.l10n.t(`Local certificate doesn't match remote`));
            }
        }
        else {
            throw new Error(`Could not read client certificate on host: ${remote.stderr}`);
        }
    }
    else {
        throw new Error(vscode_1.default.l10n.t(`Local certificate not found`));
    }
}
exports.checkClientCertificate = checkClientCertificate;
//# sourceMappingURL=certificates.js.map