"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.disposeConnection = exports.newConnection = exports.CONNECTION_TIMEOUT = exports.testStorage = void 0;
const path_1 = __importDefault(require("path"));
const IBMi_1 = __importDefault(require("../IBMi"));
const copyToImport_1 = require("../components/copyToImport");
const cqsh_1 = require("../components/cqsh");
const getMemberInfo_1 = require("../components/getMemberInfo");
const getNewLibl_1 = require("../components/getNewLibl");
const manager_1 = require("../components/manager");
const CodeForIStorage_1 = require("../configuration/storage/CodeForIStorage");
const customCli_1 = require("./components/customCli");
const testConfigSetup_1 = require("./testConfigSetup");
exports.testStorage = new testConfigSetup_1.JsonStorage();
const testConfig = new testConfigSetup_1.JSONConfig();
exports.CONNECTION_TIMEOUT = process.env.VITE_CONNECTION_TIMEOUT ? parseInt(process.env.VITE_CONNECTION_TIMEOUT) : 25000;
if (!process.env.VITE_SERVER || !process.env.VITE_DB_USER || !process.env.VITE_DB_PASS) {
    const messages = [
        ``,
        `Please set the environment variables:`,
        `\tVITE_SERVER`,
        `\tVITE_DB_USER`,
        `\tVITE_DB_PASS`,
        `\tVITE_DB_PORT`,
        ``,
        `If you're a developer, make a copy of .env.sample,`,
        `rename it to .env, and set the values.`,
        ``,
    ];
    console.log(messages.join(`\n`));
    process.exit(1);
}
const ENV_CREDS = {
    host: process.env.VITE_SERVER,
    username: process.env.VITE_DB_USER,
    password: process.env.VITE_DB_PASS,
    port: parseInt(process.env.VITE_DB_PORT || `22`),
    tempLibrary: process.env.VITE_TEMP_LIB || 'ILEDITOR'
};
async function newConnection(reloadSettings) {
    const virtualStorage = exports.testStorage;
    IBMi_1.default.GlobalStorage = new CodeForIStorage_1.CodeForIStorage(virtualStorage);
    IBMi_1.default.connectionManager.configMethod = testConfig;
    const conn = new IBMi_1.default();
    const customQsh = new cqsh_1.CustomQSh();
    const cqshPath = path_1.default.join(__dirname, `..`, `components`, `cqsh`, `cqsh`);
    customQsh.setLocalAssetPath(cqshPath);
    const testingId = `testing`;
    manager_1.extensionComponentRegistry.registerComponent(testingId, customQsh);
    manager_1.extensionComponentRegistry.registerComponent(testingId, new getNewLibl_1.GetNewLibl());
    manager_1.extensionComponentRegistry.registerComponent(testingId, new getMemberInfo_1.GetMemberInfo());
    manager_1.extensionComponentRegistry.registerComponent(testingId, new copyToImport_1.CopyToImport());
    manager_1.extensionComponentRegistry.registerComponent(testingId, new customCli_1.CustomCLI());
    const creds = {
        ...ENV_CREDS,
        name: `${ENV_CREDS.host}_${ENV_CREDS.username}_test`
    };
    // Override this so not to spam the console.
    conn.appendOutput = (data) => { };
    const result = await conn.connect(creds, {
        callbacks: {
            message: (type, message) => {
                // console.log(`${type.padEnd(10)} ${message}`);
            },
            progress: ({ message }) => {
                // console.log(`PROGRESS: ${message}`);
            },
            uiErrorHandler: async (connection, code, data) => {
                console.log(`Connection warning: ${code}: ${JSON.stringify(data)}`);
                return false;
            },
        },
        reloadServerSettings: reloadSettings,
        reconnecting: false,
    });
    if (reloadSettings) {
        const config = conn.getConfig();
        if (config.tempLibrary !== ENV_CREDS.tempLibrary) {
            config.tempLibrary = ENV_CREDS.tempLibrary;
            await IBMi_1.default.connectionManager.update(config);
        }
    }
    if (!result.success) {
        throw new Error(`Failed to connect to IBMi${result.error ? `: ${result.error}` : '!'}`);
    }
    return conn;
}
exports.newConnection = newConnection;
async function disposeConnection(connection) {
    if (connection) {
        await connection.dispose();
        exports.testStorage.save();
        testConfig.save();
    }
}
exports.disposeConnection = disposeConnection;
//# sourceMappingURL=connection.js.map