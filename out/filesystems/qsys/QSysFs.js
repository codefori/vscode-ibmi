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
exports.QSysFS = exports.isProtectedFilter = exports.parseFSOptions = exports.getFilePermission = exports.getUriFromPath = exports.getMemberUri = void 0;
const path_1 = require("path");
const querystring_1 = require("querystring");
const vscode_1 = __importStar(require("vscode"));
const Tools_1 = require("../../api/Tools");
const Configuration_1 = require("../../config/Configuration");
const instantiate_1 = require("../../instantiate");
const extendedContent_1 = require("./extendedContent");
const FSUtils_1 = require("./FSUtils");
const sourceDateHandler_1 = require("./sourceDateHandler");
function getMemberUri(member, options) {
    return getUriFromPath(`${member.asp ? `${member.asp}/` : ``}${member.library}/${member.file}/${member.name}.${member.extension}`, options);
}
exports.getMemberUri = getMemberUri;
function getUriFromPath(path, options) {
    const query = (0, querystring_1.stringify)(options);
    if (path.startsWith(`/`)) {
        //IFS path
        return vscode_1.default.Uri.parse(path).with({ scheme: `streamfile`, path, query });
    }
    else {
        //QSYS path
        return vscode_1.default.Uri.parse(path).with({ scheme: `member`, path: `/${path}`, query });
    }
}
exports.getUriFromPath = getUriFromPath;
function getFilePermission(uri) {
    const fsOptions = parseFSOptions(uri);
    if (instantiate_1.instance.getConnection()?.getConfig().readOnlyMode || fsOptions.readonly) {
        return vscode_1.FilePermission.Readonly;
    }
}
exports.getFilePermission = getFilePermission;
function parseFSOptions(uri) {
    const parameters = (0, querystring_1.parse)(uri.query);
    return {
        readonly: parameters.readonly === `true`
    };
}
exports.parseFSOptions = parseFSOptions;
function isProtectedFilter(filter) {
    return filter && instantiate_1.instance.getConnection()?.getConfig().objectFilters.find(f => f.name === filter)?.protected || false;
}
exports.isProtectedFilter = isProtectedFilter;
class QSysFS {
    savedAsMembers = new Set;
    sourceDateHandler;
    extendedContent;
    extendedMemberSupport = false;
    emitter = new vscode_1.default.EventEmitter();
    onDidChangeFile = this.emitter.event;
    constructor(context) {
        this.sourceDateHandler = new sourceDateHandler_1.SourceDateHandler(context);
        this.extendedContent = new extendedContent_1.ExtendedIBMiContent(this.sourceDateHandler);
        instantiate_1.instance.subscribe(context, 'connected', `Update member support`, () => this.updateMemberSupport());
        instantiate_1.instance.subscribe(context, 'disconnected', `Update member support & clear library ASP cache`, () => {
            this.updateMemberSupport();
        });
        context.subscriptions.push((0, Configuration_1.onCodeForIBMiConfigurationChange)("connectionSettings", () => {
            if (this.extendedMemberSupport !== instantiate_1.instance.getConnection()?.getConfig().enableSourceDates) {
                instantiate_1.instance.getStorage()?.unmarkMessageAsShown(SOURCE_DATES_RESET_WARNING);
                this.updateMemberSupport();
                const openedMembers = vscode_1.default.window.tabGroups.all
                    .flatMap(group => group.tabs)
                    .filter(tab => tab.input instanceof vscode_1.default.TabInputText)
                    .map(tab => tab.input.uri)
                    .filter(uri => uri.scheme === "member");
                if (this.extendedMemberSupport === instantiate_1.instance.getConnection()?.getConfig().enableSourceDates && openedMembers.length) {
                    vscode_1.default.window.showWarningMessage(vscode_1.l10n.t("Source date support is now {0}. Please backup and then close opened IBM i source member(s):", this.extendedMemberSupport ? vscode_1.l10n.t("enabled") : vscode_1.l10n.t("disabled")), { modal: true, detail: openedMembers.map(e => `- ${e.path.substring(1)}`).join("\n") });
                }
            }
        }));
    }
    updateMemberSupport() {
        this.extendedMemberSupport = false;
        const connection = instantiate_1.instance.getConnection();
        const config = connection?.getConfig();
        if (connection && config?.enableSourceDates) {
            if (connection.sqlRunnerAvailable()) {
                this.extendedMemberSupport = true;
            }
            else {
                vscode_1.default.window.showErrorMessage(`Source date support is enabled, but the remote system does not support SQL. Source date support will be disabled.`);
            }
        }
        this.sourceDateHandler.setEnabled(this.extendedMemberSupport);
    }
    async stat(uri) {
        const path = uri.path;
        const pathParts = path.split(`/`).filter(Boolean);
        if (pathParts.length > 4 || !path.startsWith('/')) {
            throw new vscode_1.default.FileSystemError("Invalid member path");
        }
        let type = vscode_1.default.FileType.File;
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const filePathLength = connection.getIAspDetail(pathParts[0]) ? 4 : 3;
            if (pathParts.length < filePathLength) {
                type = vscode_1.default.FileType.Directory;
            }
            if (type === vscode_1.default.FileType.File) {
                const member = (0, path_1.parse)(path).name;
                const qsysPath = { ...Tools_1.Tools.parseQSysPath(path), member };
                const attributes = await this.getMemberAttributes(connection, qsysPath);
                if (attributes) {
                    return {
                        ctime: Tools_1.Tools.parseAttrDate(String(attributes.CREATE_TIME)),
                        mtime: Tools_1.Tools.parseAttrDate(String(attributes.MODIFY_TIME)),
                        size: Number(attributes.DATA_SIZE),
                        type,
                        permissions: member && !this.savedAsMembers.has(uri.path) ? getFilePermission(uri) : undefined
                    };
                }
                else {
                    throw vscode_1.FileSystemError.FileNotFound(uri);
                }
            }
        }
        return {
            ctime: 0,
            mtime: 0,
            size: 0,
            type,
            permissions: getFilePermission(uri)
        };
    }
    async getMemberAttributes(connection, path) {
        path.asp = path.asp || await connection.lookupLibraryIAsp(path.library);
        return await connection.getContent().getAttributes(path, "CREATE_TIME", "MODIFY_TIME", "DATA_SIZE");
    }
    parseMemberPath(connection, path) {
        const memberParts = connection.parserMemberPath(path);
        memberParts.asp = memberParts.asp || connection.getLibraryIAsp(memberParts.library);
        return memberParts;
    }
    async readFile(uri, retrying) {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const contentApi = connection.getContent();
            let { asp, library, file, name: member } = this.parseMemberPath(connection, uri.path);
            asp = asp || await connection.lookupLibraryIAsp(library);
            let memberContent;
            try {
                memberContent = this.extendedMemberSupport ?
                    await this.extendedContent.downloadMemberContentWithDates(uri) :
                    await contentApi.downloadMemberContent(library, file, member);
            }
            catch (error) {
                if (!retrying && await this.stat(uri)) { //Check if exists on an iASP and retry if so
                    return this.readFile(uri, true);
                }
                throw error;
            }
            if (memberContent !== undefined) {
                return new Uint8Array(Buffer.from(memberContent, `utf8`));
            }
            else {
                throw new vscode_1.FileSystemError(`Couldn't read ${uri}; check IBM i connection.`);
            }
        }
        else {
            if (retrying) {
                throw new vscode_1.FileSystemError("Not connected to IBM i");
            }
            else {
                if (await (0, FSUtils_1.reconnectFS)(uri)) {
                    this.updateMemberSupport(); //this needs to be done right after reconnecting, before the member is read (the connect event may be triggered too late at this point)
                    return this.readFile(uri, true);
                }
                else {
                    return Buffer.alloc(0);
                }
            }
        }
    }
    async writeFile(uri, content, options) {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const readonly = connection.getConfig().readOnlyMode;
            if (readonly) {
                throw new vscode_1.FileSystemError("Connection is in readonly mode");
            }
            const contentApi = connection.getContent();
            let { asp, library, file, name: member, extension } = this.parseMemberPath(connection, uri.path);
            asp = asp || await connection.lookupLibraryIAsp(library);
            if (!content.length) { //Coming from "Save as"
                const addMember = await connection.runCommand({
                    command: `ADDPFM FILE(${library}/${file}) MBR(${member}) SRCTYPE(${extension || '*NONE'})`,
                    noLibList: true
                });
                if (addMember.code === 0) {
                    this.savedAsMembers.add(uri.path);
                    vscode_1.default.commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`);
                }
                else {
                    throw new vscode_1.FileSystemError(addMember.stderr);
                }
            }
            else {
                this.savedAsMembers.delete(uri.path);
                if (this.extendedMemberSupport) {
                    await this.extendedContent.uploadMemberContentWithDates(uri, content.toString());
                }
                else {
                    await warnAboutSourceDates();
                    await contentApi.uploadMemberContent(library, file, member, content);
                }
            }
        }
        else {
            throw new vscode_1.FileSystemError("Not connected to IBM i");
        }
    }
    rename(oldUri, newUri, options) {
        //Not used at the moment
    }
    watch(uri, options) {
        return { dispose: () => { } };
    }
    async readDirectory(uri) {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const content = connection.getContent();
            const qsysPath = Tools_1.Tools.parseQSysPath(uri.path);
            if (qsysPath.name) {
                return (await content.getMemberList({ library: qsysPath.library, sourceFile: qsysPath.name }))
                    .map(member => [`${member.name}${member.extension ? `.${member.extension}` : ''}`, vscode_1.default.FileType.File]);
            }
            else if (qsysPath.library) {
                return (await content.getObjectList({ library: qsysPath.library, types: ["*SRCPF"] }))
                    .map(srcPF => [srcPF.name, vscode_1.default.FileType.Directory]);
            }
            else if (uri.path === '/') {
                return (await connection.runSQL(`select OBJNAME from table (QSYS2.OBJECT_STATISTICS ('*ALLSIMPLE', 'LIB', '*ALLSIMPLE'))`))
                    .map(row => [row.OBJNAME, vscode_1.default.FileType.Directory]);
            }
        }
        throw vscode_1.FileSystemError.FileNotFound(uri);
    }
    async createDirectory(uri) {
        const connection = instantiate_1.instance.getConnection();
        if (connection) {
            const qsysPath = Tools_1.Tools.parseQSysPath(uri.path);
            if (qsysPath.library && !await connection.getContent().checkObject({ library: "QSYS", name: qsysPath.library, type: "*LIB" })) {
                const createLibrary = await connection.runCommand({
                    command: `CRTLIB LIB(${qsysPath.library})`,
                    noLibList: true
                });
                if (createLibrary.code !== 0) {
                    throw vscode_1.FileSystemError.NoPermissions(createLibrary.stderr);
                }
            }
            if (qsysPath.name) {
                const createFile = await connection.runCommand({
                    command: `CRTSRCPF FILE(${qsysPath.library}/${qsysPath.name}) RCDLEN(112)`,
                    noLibList: true
                });
                if (createFile.code !== 0) {
                    throw vscode_1.FileSystemError.NoPermissions(createFile.stderr);
                }
            }
        }
    }
    delete(uri, options) {
        throw new vscode_1.FileSystemError("Method not implemented.");
    }
}
exports.QSysFS = QSysFS;
const SOURCE_DATES_RESET_WARNING = 'sourceDatesResetWarning';
async function warnAboutSourceDates() {
    const storage = instantiate_1.instance.getStorage();
    if (!storage?.hasMessageBeenShown(SOURCE_DATES_RESET_WARNING)) {
        const save = vscode_1.l10n.t("Save");
        const dismiss = vscode_1.l10n.t("Save & don't show again");
        const openSettings = vscode_1.l10n.t("Cancel & open settings");
        const choice = await vscode_1.default.window.showWarningMessage(vscode_1.l10n.t("Source date support is disabled. Saving now will set all the dates to 0. Do you wish to proceed anyway?"), { modal: true }, save, dismiss, openSettings);
        switch (choice) {
            case save:
                //Do nothing, proceed
                break;
            case dismiss:
                await storage?.markMessageAsShown(SOURCE_DATES_RESET_WARNING);
                break;
            case openSettings:
                vscode_1.default.commands.executeCommand(`code-for-ibmi.showAdditionalSettings`, undefined, `Source Code`);
            default:
                throw vscode_1.FileSystemError.Unavailable(vscode_1.l10n.t("Save operation aborted"));
        }
    }
}
//# sourceMappingURL=QSysFs.js.map