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
exports.IFSFS = void 0;
const vscode_1 = __importStar(require("vscode"));
const Tools_1 = require("../api/Tools");
const instantiate_1 = require("../instantiate");
const FSUtils_1 = require("./qsys/FSUtils");
const QSysFs_1 = require("./qsys/QSysFs");
class IFSFS {
    savedAsFiles = new Set;
    emitter = new vscode_1.default.EventEmitter();
    onDidChangeFile = this.emitter.event;
    watch(uri, options) {
        return { dispose: () => { } };
    }
    async readFile(uri, retrying) {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const contentApi = connection.getContent();
            const fileContent = await contentApi.downloadStreamfileRaw(uri.path);
            return fileContent;
        }
        else {
            if (retrying) {
                throw new vscode_1.FileSystemError("Not connected to IBM i");
            }
            else {
                if (await (0, FSUtils_1.reconnectFS)(uri)) {
                    return this.readFile(uri, true);
                }
                else {
                    return Buffer.alloc(0);
                }
            }
        }
    }
    async stat(uri) {
        const connnection = instantiate_1.instance.getConnection();
        if (connnection) {
            const content = connnection.getContent();
            const path = uri.path;
            if (await content.testStreamFile(path, "e")) {
                const attributes = await content.getAttributes(path, "CREATE_TIME", "MODIFY_TIME", "DATA_SIZE", "OBJTYPE");
                if (attributes) {
                    const type = String(attributes.OBJTYPE) === "*DIR" ? vscode_1.default.FileType.Directory : vscode_1.default.FileType.File;
                    return {
                        ctime: Tools_1.Tools.parseAttrDate(String(attributes.CREATE_TIME)),
                        mtime: Tools_1.Tools.parseAttrDate(String(attributes.MODIFY_TIME)),
                        size: Number(attributes.DATA_SIZE),
                        type,
                        permissions: !this.savedAsFiles.has(path) && type !== vscode_1.FileType.Directory ? (0, QSysFs_1.getFilePermission)(uri) : undefined
                    };
                }
            }
            throw vscode_1.FileSystemError.FileNotFound(uri);
        }
        else {
            return {
                ctime: 0,
                mtime: 0,
                size: 0,
                type: vscode_1.default.FileType.File,
                permissions: (0, QSysFs_1.getFilePermission)(uri)
            };
        }
    }
    async writeFile(uri, content, options) {
        const path = uri.path;
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const readonly = connection.getConfig().readOnlyMode;
            if (readonly) {
                throw new vscode_1.FileSystemError("Connection is in readonly mode");
            }
            const contentApi = connection.getContent();
            if (!content.length) { //Coming from "Save as"    
                this.savedAsFiles.add(path);
                await contentApi.createStreamFile(path);
                vscode_1.default.commands.executeCommand(`code-for-ibmi.refreshIFSBrowser`);
            }
            else {
                this.savedAsFiles.delete(path);
                await contentApi.writeStreamfileRaw(path, content);
            }
        }
        else {
            throw new vscode_1.FileSystemError("Not connected to IBM i");
        }
    }
    copy(source, destination, options) {
        //not used at the moment
    }
    rename(oldUri, newUri, options) {
        //not used at the moment
    }
    async readDirectory(uri) {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const content = connection.getContent();
            return (await content.getFileList(uri.path)).map(ifsFile => ([ifsFile.name, ifsFile.type === "directory" ? vscode_1.FileType.Directory : vscode_1.FileType.File]));
        }
        else {
            throw new vscode_1.FileSystemError("Not connected to IBM i");
        }
    }
    async createDirectory(uri) {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const path = uri.path;
            if (await connection.getContent().testStreamFile(path, "d")) {
                throw vscode_1.FileSystemError.FileExists(uri);
            }
            else {
                const result = await connection.sendCommand({ command: `mkdir -p ${path}` });
                if (result.code !== 0) {
                    throw vscode_1.FileSystemError.NoPermissions(result.stderr);
                }
            }
        }
    }
    delete(uri, options) {
        throw new vscode_1.FileSystemError(`delete not implemented in IFSFS.`);
    }
}
exports.IFSFS = IFSFS;
//# sourceMappingURL=ifsFs.js.map