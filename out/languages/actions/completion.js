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
exports.LocalActionCompletionItemProvider = void 0;
const vscode_1 = __importStar(require("vscode"));
const ITEMS = {
    "BASENAME": vscode_1.default.l10n.t("Name of the file, including the extension"),
    "BRANCH": vscode_1.default.l10n.t("Current Git branch"),
    "BRANCHLIB": vscode_1.default.l10n.t("Branch library, based on the current branch"),
    "BUILDLIB": vscode_1.default.l10n.t("The same as <code>&amp;CURLIB</code>"),
    "CURLIB": vscode_1.default.l10n.t("Current library, changeable in Library List"),
    "EXT": vscode_1.default.l10n.t("File type"),
    "EXTL": vscode_1.default.l10n.t("Lowercase file type"),
    "FILEDIR": vscode_1.default.l10n.t("Directory of the file on the remote system"),
    "FULLPATH": vscode_1.default.l10n.t("Full path of the file on the remote system"),
    "HOST": vscode_1.default.l10n.t("Hostname or IP address from the current connection"),
    "LIBLC": vscode_1.default.l10n.t("Library list delimited by comma"),
    "LIBLS": vscode_1.default.l10n.t("Library list delimited by space"),
    "LIBRARY": vscode_1.default.l10n.t("Library name where the object lives (<code>&amp;LIBRARYL</code> for lowercase)"),
    "LOCALPATH": vscode_1.default.l10n.t("Local source file path"),
    "NAME": vscode_1.default.l10n.t("Name of the object (<code>&amp;NAMEL</code> for lowercase)"),
    "NAMEL": vscode_1.default.l10n.t("Lowercase name of the object"),
    "PARENT": vscode_1.default.l10n.t("Name of the parent directory or source file"),
    "RELATIVEPATH": vscode_1.default.l10n.t("Relative path of the streamfile from the working directory or workspace"),
    "USERNAME": vscode_1.default.l10n.t("Username for connection"),
    "WORKDIR": vscode_1.default.l10n.t("Current working directory, changeable in IFS Browser"),
};
class LocalActionCompletionItemProvider {
    provideCompletionItems(document, position, token, context) {
        const text = document.lineAt(position.line).text?.trim();
        //Only provide items if the cursor is on a "command" or "outputToFile" line
        if (/^\s*"(command|outputToFile)"\s*:/.test(text)) {
            return Object.entries(ITEMS).map(([variable, label]) => ({
                label: variable,
                detail: label.replaceAll(/<code>|<\/code>|&amp;/g, ""),
                insertText: context.triggerCharacter ? undefined : `&${variable}`,
                kind: vscode_1.default.CompletionItemKind.Variable
            }));
        }
        else if (!text || text === "},") {
            const snippet = new vscode_1.default.CompletionItem("action");
            snippet.insertText = new vscode_1.default.SnippetString('{\n  "name": "$1",\n  "command": "$2",\n  "environment": "ile",\n  "extensions": [\n      "$3GLOBAL"\n    ]\n}');
            snippet.documentation = new vscode_1.default.MarkdownString(vscode_1.l10n.t("Code for IBM i action"));
            return [snippet];
        }
    }
}
exports.LocalActionCompletionItemProvider = LocalActionCompletionItemProvider;
//# sourceMappingURL=completion.js.map