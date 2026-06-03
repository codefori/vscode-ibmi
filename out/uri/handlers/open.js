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
exports.openURIHandler = void 0;
const promises_1 = __importDefault(require("dns/promises"));
const querystring_1 = __importDefault(require("querystring"));
const vscode_1 = __importStar(require("vscode"));
const IBMi_1 = __importDefault(require("../../api/IBMi"));
/**
 * Handles /open with the following query parameters:
 *  - `path`: an IFS path; supports /QSYS.LIB paths to open members
 *  - `host` (optional): the IBM i host to connect to; can be a host name, an IP or a server configuration name use current connection if not specified
 *  - `user`(optional): if specified with host, a connection with the specified user must exist
 *  - `readonly`: if specified, the member/file will be opened in read-only mode
 *
 * Examples:
 * - /open?path=/tmp/test.txt
 * - /open?path=/tmp/dontchange.txt&readonly
 * - /open?host=PUB400.com&user=JOHNDOE&path=/tmp/dontchange.txt&readonly
 */
exports.openURIHandler = {
    canHandle: (path) => path === `/open`,
    async handle(uri, connection) {
        try {
            const parameters = await loadParameters(querystring_1.default.parse(uri.query), connection);
            if (!parameters.cancel) {
                let doOpen = true;
                if (parameters.connect && parameters.host) {
                    doOpen = await vscode_1.default.commands.executeCommand(`code-for-ibmi.connectTo`, parameters.host.name);
                }
                if (doOpen) {
                    vscode_1.default.commands.executeCommand("code-for-ibmi.openWithDefaultMode", parameters.path, parameters.readonly);
                }
            }
        }
        catch (error) {
            let message;
            if (error.code === "ENOTFOUND") {
                message = vscode_1.l10n.t("Could not resolve hostname {0}", error.hostname);
            }
            else if (error instanceof Error) {
                message = error.message;
            }
            else if (typeof error === "string") {
                message = error;
            }
            else {
                message = String(error);
            }
            vscode_1.default.window.showErrorMessage(message);
        }
    }
};
function toBoolean(value) {
    return value !== undefined && (value === "" || value.toLowerCase() === "true");
}
async function loadParameters(query, connection) {
    const path = toPath(query.path);
    const readonly = toBoolean(query.readonly) ? "browse" : undefined;
    const user = query.user?.toLocaleUpperCase();
    const connectionData = await resolveConnectionData(query.host, user);
    let connect;
    let cancel;
    if (!connection && !connectionData) {
        throw vscode_1.l10n.t("Not connected to IBM i: 'host' query parameter is required");
    }
    if (connection && connectionData) {
        if (await getIP(connectionData.host) !== await getIP(connection.currentHost) || (user && connection.currentUser.toLocaleUpperCase() !== user)) {
            const message = user ? vscode_1.l10n.t("You're currently connected to {0} with user profile {1}. Do you want to disconnect and switch to {2} with user profile {3}?", connection.currentHost, connection.currentUser, connectionData.host, user) :
                vscode_1.l10n.t("You're currently connected to {0}. Do you want to disconnect and switch to {1}?", connection.currentConnectionName, connectionData.name);
            if (await vscode_1.default.window.showWarningMessage(message, { modal: true }, vscode_1.l10n.t("Connect to {0}", connectionData.name))) {
                connect = true;
            }
            else {
                cancel = true;
            }
        }
    }
    else if (connectionData) {
        connect = true;
    }
    return { path, readonly, host: connectionData, connect, cancel };
}
/**
 * Search for `host` in the configured connections, by name, and then by IP.
 *
 * @param host a host address or IP
 * @returns the corresponding {@link ConnectionData}
 * @throws an `Error` if DNS lookup fails or if no configuration matches this host
 */
async function resolveConnectionData(host, user) {
    if (host) {
        const userMatches = (connectionData) => !user || connectionData.username.toLocaleUpperCase() === user;
        const connectionByName = IBMi_1.default.connectionManager.getByName(host)?.data;
        if (connectionByName && userMatches(connectionByName)) {
            return connectionByName;
        }
        const ip = !/^((25[0-5]|(2[0-4]|1\d|[1-9]|)\d)\.?\b){4}$/.test(host) ? await getIP(host) : host;
        for (const connection of IBMi_1.default.connectionManager.getAll()) {
            if (await getIP(connection.host) === ip && userMatches(connection)) {
                return connection;
            }
        }
        if (user) {
            throw new Error(vscode_1.l10n.t("No connection matches name or host {0} ({1}) with user {2}", host, ip, user));
        }
        else {
            throw new Error(vscode_1.l10n.t("No connection matches name or host {0} ({1})", host, ip));
        }
    }
}
function toPath(path) {
    if (!path) {
        throw vscode_1.l10n.t("'path' query parameter is required");
    }
    return { path };
}
async function getIP(host) {
    return (await promises_1.default.lookup(host)).address;
}
//# sourceMappingURL=open.js.map