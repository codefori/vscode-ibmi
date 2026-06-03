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
exports.VscodeTools = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = require("fs");
const vscode_1 = __importStar(require("vscode"));
const Tools_1 = require("../api/Tools");
let gitLookedUp;
let gitAPI;
var VscodeTools;
(function (VscodeTools) {
    function getGitAPI() {
        if (!gitLookedUp) {
            try {
                gitAPI = vscode_1.default.extensions.getExtension(`vscode.git`)?.exports.getAPI(1);
            }
            catch (error) {
                console.log(`Git extension issue.`, error);
            }
            finally {
                gitLookedUp = true;
            }
        }
        return gitAPI;
    }
    VscodeTools.getGitAPI = getGitAPI;
    function md5Hash(file) {
        const bytes = (0, fs_1.readFileSync)(file.fsPath);
        return crypto_1.default.createHash("md5")
            .update(bytes)
            .digest("hex")
            .toLowerCase();
    }
    VscodeTools.md5Hash = md5Hash;
    /**
     * Check whether two given uris point to the same file/member
     */
    function areEquivalentUris(uriA, uriB) {
        return uriStringWithoutFragment(uriA) === uriStringWithoutFragment(uriB);
    }
    VscodeTools.areEquivalentUris = areEquivalentUris;
    /**
     * We do this to find previously opened files with the same path, but different case OR readonly flags.
     * Without this, it's possible for the same document to be opened twice simply due to the readonly flag.
     */
    function findExistingDocumentUri(uri) {
        const possibleDoc = findExistingDocument(uri);
        return possibleDoc?.uri || uri;
    }
    VscodeTools.findExistingDocumentUri = findExistingDocumentUri;
    function findExistingDocument(uri) {
        const baseUriString = uriStringWithoutFragment(uri);
        const possibleDoc = vscode_1.default.workspace.textDocuments.find(document => uriStringWithoutFragment(document.uri) === baseUriString);
        return possibleDoc;
    }
    VscodeTools.findExistingDocument = findExistingDocument;
    function findExistingDocumentByName(nameAndExt) {
        const possibleDoc = vscode_1.default.workspace.textDocuments.find(document => document.fileName.toLowerCase().endsWith(nameAndExt.toLowerCase()));
        return possibleDoc ? possibleDoc.uri : undefined;
    }
    VscodeTools.findExistingDocumentByName = findExistingDocumentByName;
    /**
     * We convert member to lowercase as members are case insensitive.
     */
    function uriStringWithoutFragment(uri) {
        // To lowercase because the URI path is case-insensitive
        const baseUri = uri.scheme + `:` + uri.path;
        const isCaseSensitive = (uri.scheme === `streamfile` && /^\/QOpenSys\//i.test(uri.path));
        return (isCaseSensitive ? baseUri : baseUri.toLowerCase());
    }
    /**
     * Given the uri of a member or other resource, find all
     * (if any) open tabs where that resource is being edited.
    */
    function findUriTabs(uriToFind) {
        let resourceTabs = [];
        for (const group of vscode_1.default.window.tabGroups.all) {
            group.tabs.filter(tab => (tab.input instanceof vscode_1.default.TabInputText)
                && (uriToFind instanceof vscode_1.default.Uri ? areEquivalentUris(tab.input.uri, uriToFind) : tab.input.uri.path.startsWith(`${uriToFind}/`))).forEach(tab => {
                resourceTabs.push(tab);
            });
        }
        return resourceTabs;
    }
    VscodeTools.findUriTabs = findUriTabs;
    function generateTooltipHtmlTable(header, rows) {
        return `<table>`
            .concat(`${header ? `<thead>${header}</thead>` : ``}`)
            .concat(`${Object.entries(rows)
            .filter(([key, value]) => value !== undefined && value !== '')
            .map(([key, value]) => `<tr><td>${vscode_1.default.l10n.t(key)}:</td><td>&nbsp;${value}</td></tr>`)
            .join(``)}`)
            .concat(`</table>`);
    }
    VscodeTools.generateTooltipHtmlTable = generateTooltipHtmlTable;
    function escapeHtml(html) {
        return html
            .replaceAll("&", '&amp;')
            .replaceAll("<", '&lt;')
            .replaceAll(">", '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }
    VscodeTools.escapeHtml = escapeHtml;
    const activeContexts = new Map;
    /**
     * Runs a function while a context value is set to true.
     *
     * If multiple callers call this function with the same context, only the last one returning will unset the context value.
     *
     * @param context the context value that will be set to `true` during `task` execution
     * @param task the function to run while the context value is `true`
     */
    async function withContext(context, task) {
        try {
            let stack = activeContexts.get(context);
            if (stack === undefined) {
                await vscode_1.default.commands.executeCommand(`setContext`, context, true);
                activeContexts.set(context, 0);
            }
            else {
                stack++;
                activeContexts.set(context, stack);
            }
            return await task();
        }
        finally {
            let stack = activeContexts.get(context);
            if (stack !== undefined) {
                if (stack) {
                    stack--;
                    activeContexts.set(context, stack);
                }
                else {
                    await vscode_1.default.commands.executeCommand(`setContext`, context, undefined);
                    activeContexts.delete(context);
                }
            }
        }
    }
    VscodeTools.withContext = withContext;
    function objectToToolTip(path, object) {
        const tooltip = new vscode_1.MarkdownString(generateTooltipHtmlTable(path, {
            "Type": object.type,
            "Attribute": object.attribute,
            "Text": object.text,
            "Size": object.size,
            "Created": safeIsoValue(object.created),
            "Changed": safeIsoValue(object.changed),
            "Created by": object.created_by,
            "Owner": object.owner,
            "IASP": object.asp
        }));
        tooltip.supportHtml = true;
        return tooltip;
    }
    VscodeTools.objectToToolTip = objectToToolTip;
    async function sourcePhysicalFileToToolTip(connection, path, object) {
        const content = connection.getContent();
        const tooltip = new vscode_1.MarkdownString(generateTooltipHtmlTable(path, {
            "Text": object.text,
            "Members": await content.countMembers(object),
            "Length": object.sourceLength,
            "CCSID": (await content.getAttributes(object, "CCSID"))?.CCSID || '?',
            "IASP": object.asp
        }));
        tooltip.supportHtml = true;
        return tooltip;
    }
    VscodeTools.sourcePhysicalFileToToolTip = sourcePhysicalFileToToolTip;
    function memberToToolTip(path, member) {
        const tooltip = new vscode_1.MarkdownString(generateTooltipHtmlTable(path, {
            "Text": member.text,
            "Lines": member.lines,
            "Created": safeIsoValue(member.created),
            "Changed": safeIsoValue(member.changed)
        }));
        tooltip.supportHtml = true;
        return tooltip;
    }
    VscodeTools.memberToToolTip = memberToToolTip;
    function ifsFileToToolTip(path, ifsFile) {
        const tooltip = new vscode_1.MarkdownString(generateTooltipHtmlTable(path, {
            "Size": ifsFile.size,
            "Modified": ifsFile.modified ? safeIsoValue(new Date(ifsFile.modified.getTime() - ifsFile.modified.getTimezoneOffset() * 60 * 1000)) : ``,
            "Owner": ifsFile.owner ? ifsFile.owner.toUpperCase() : ``
        }));
        tooltip.supportHtml = true;
        return tooltip;
    }
    VscodeTools.ifsFileToToolTip = ifsFileToToolTip;
    function profileToToolTip(profile) {
        const tooltip = new vscode_1.MarkdownString(generateTooltipHtmlTable('', {
            "Home Directory": profile.homeDirectory,
            "Current Library": profile.currentLibrary,
            "Library List": profile.libraryList,
            "Library List Command": profile.setLibraryListCommand,
            "Object Filters": profile.objectFilters.length,
            "IFS Shortcuts": profile.ifsShortcuts.length,
            "Custom Variables": profile.customVariables.length,
        }));
        tooltip.supportHtml = true;
        return tooltip;
    }
    VscodeTools.profileToToolTip = profileToToolTip;
    function includesCaseInsensitive(haystack, needle) {
        return haystack.map(s => s.toLocaleUpperCase()).includes(needle.toLocaleUpperCase());
    }
    VscodeTools.includesCaseInsensitive = includesCaseInsensitive;
    function safeIsoValue(date) {
        try {
            return date ? date.toISOString().slice(0, 19).replace(`T`, ` `) : ``;
        }
        catch (e) {
            return `Unknown`;
        }
    }
    // These are exported to not break the API from 'the great re-write'.
    VscodeTools.qualifyPath = Tools_1.Tools.qualifyPath;
    VscodeTools.unqualifyPath = Tools_1.Tools.unqualifyPath;
    VscodeTools.escapePath = Tools_1.Tools.escapePath;
    VscodeTools.distinct = Tools_1.Tools.distinct;
    VscodeTools.capitalize = Tools_1.Tools.capitalize;
    VscodeTools.sanitizeObjNamesForPase = Tools_1.Tools.sanitizeObjNamesForPase;
    VscodeTools.parseMessages = Tools_1.Tools.parseMessages;
    VscodeTools.parseQSysPath = Tools_1.Tools.parseQSysPath;
    VscodeTools.fileToPath = Tools_1.Tools.fileToPath;
    VscodeTools.fixWindowsPath = Tools_1.Tools.fixWindowsPath;
    VscodeTools.parseAttrDate = Tools_1.Tools.parseAttrDate;
    VscodeTools.normalizePath = Tools_1.Tools.normalizePath;
    VscodeTools.resolvePath = Tools_1.Tools.resolvePath;
    VscodeTools.makeid = Tools_1.Tools.makeid;
})(VscodeTools = exports.VscodeTools || (exports.VscodeTools = {}));
//# sourceMappingURL=Tools.js.map