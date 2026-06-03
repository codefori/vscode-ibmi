"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getJavaHome = exports.getDebugServiceDetails = exports.resetDebugServiceDetails = exports.DebugConfiguration = exports.ORIGINAL_DEBUG_CONFIG_FILE = exports.CLIENT_CERTIFICATE = exports.SERVICE_CERTIFICATE = void 0;
const path_1 = __importDefault(require("path"));
exports.SERVICE_CERTIFICATE = `debug_service.pfx`;
exports.CLIENT_CERTIFICATE = `debug_service.crt`;
exports.ORIGINAL_DEBUG_CONFIG_FILE = "/QIBM/ProdData/IBMiDebugService/bin/DebugService.env";
class DebugConfiguration {
    connection;
    constructor(connection) {
        this.connection = connection;
    }
    configLines = [];
    getContent() {
        const content = this.connection.getContent();
        if (!content) {
            throw new Error("Not connected to an IBM i");
        }
        return content;
    }
    getOrDefault(key, defaultValue) {
        return this.get(key) || defaultValue;
    }
    get(key) {
        return this.configLines.find(line => line.key === key && line.value !== undefined)?.value;
    }
    async load() {
        const content = (await this.getContent().downloadStreamfileRaw(exports.ORIGINAL_DEBUG_CONFIG_FILE)).toString("utf-8");
        this.configLines.push(...content.split("\n")
            .map(line => line.trim())
            .map(line => {
            const equalPos = line.indexOf("=");
            if (!line || line.startsWith("#") || equalPos === -1) {
                return { key: line };
            }
            else {
                return {
                    key: line.substring(0, equalPos),
                    value: equalPos < line.length ? line.substring(equalPos + 1) : ''
                };
            }
        }));
        return this;
    }
    getRemoteServiceCertificatePath() {
        return this.getOrDefault("DEBUG_SERVICE_KEYSTORE_FILE", //the actual certificate path, set after it's been configured by Code for i
        `${this.getRemoteServiceWorkDir()}/certs/${exports.SERVICE_CERTIFICATE}`); //the service working directory as set in the config or its default value
    }
    getRemoteClientCertificatePath() {
        return this.getRemoteServiceCertificatePath().replace(".pfx", ".crt");
    }
    getRemoteServiceRoot() {
        return `${this.getOrDefault("DBGSRV_ROOT", "/QIBM/ProdData/IBMiDebugService")}`;
    }
    getRemoteServiceBin() {
        return `${this.getRemoteServiceRoot()}/bin`;
    }
    getRemoteServiceWorkDir() {
        return this.getOrDefault("DBGSRV_WRK_DIR", "/QIBM/UserData/IBMiDebugService");
    }
    getRemoteServiceWorkspace() {
        return this.getOrDefault("STR_DBGSVR_WRK_ROOT_DIR", "$DBGSRV_WRK_DIR/startDebugService_workspace")
            .replace("$DBGSRV_WRK_DIR", this.getRemoteServiceWorkDir());
    }
    getNavigatorLogFile() {
        return `${this.getRemoteServiceWorkspace()}/startDebugServiceNavigator.log`;
    }
}
exports.DebugConfiguration = DebugConfiguration;
let debugServiceDetails;
function resetDebugServiceDetails() {
    debugServiceDetails = undefined;
}
exports.resetDebugServiceDetails = resetDebugServiceDetails;
async function getDebugServiceDetails(connection) {
    if (!debugServiceDetails) {
        let details = {
            version: `0.0.0`,
            java: ``,
            semanticVersion: () => ({
                major: 0,
                minor: 0,
                patch: 0
            })
        };
        const content = connection.getContent();
        const detailFilePath = path_1.default.posix.join((await new DebugConfiguration(connection).load()).getRemoteServiceRoot(), `package.json`);
        const detailExists = await content.testStreamFile(detailFilePath, "r");
        if (detailExists) {
            const fileContents = (await content.downloadStreamfileRaw(detailFilePath)).toString("utf-8");
            const parsed = JSON.parse(fileContents);
            details = {
                ...parsed,
                semanticVersion: () => {
                    const parts = (parsed.version ? String(parsed.version).split('.') : []).map(Number);
                    return {
                        major: parts[0],
                        minor: parts[1],
                        patch: parts[2]
                    };
                }
            };
        }
        debugServiceDetails = details;
    }
    return debugServiceDetails;
}
exports.getDebugServiceDetails = getDebugServiceDetails;
function getJavaHome(connection, version) {
    version = version.padEnd(2, '0');
    const javaHome = connection.remoteFeatures[`jdk${version}`];
    return javaHome;
}
exports.getJavaHome = getJavaHome;
//# sourceMappingURL=DebugConfiguration.js.map