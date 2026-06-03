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
exports.editConnectionProfile = exports.isProfileEdited = void 0;
const vscode_1 = __importStar(require("vscode"));
const connectionProfiles_1 = require("../api/connectionProfiles");
const instantiate_1 = require("../instantiate");
const customEditorProvider_1 = require("./customEditorProvider");
const editedProfiles = new Set;
function isProfileEdited(profile) {
    return editedProfiles.has(profile.name);
}
exports.isProfileEdited = isProfileEdited;
function editConnectionProfile(profile, doAfterSave) {
    const activeProfile = (0, connectionProfiles_1.isActiveProfile)(profile);
    const config = instantiate_1.instance.getConnection()?.getConfig();
    const objectFilters = (activeProfile && config ? config : profile).objectFilters;
    const ifsShortcuts = (activeProfile && config ? config : profile).ifsShortcuts;
    const customVariables = (activeProfile && config ? config : profile).customVariables;
    new customEditorProvider_1.CustomEditor(`${profile.name}.profile`, data => save(profile, data).then(doAfterSave), () => editedProfiles.delete(profile.name))
        .addInput("homeDirectory", vscode_1.l10n.t("Home Directory"), '', { minlength: 1, default: profile.homeDirectory, readonly: activeProfile })
        .addInput("currentLibrary", vscode_1.l10n.t("Current Library"), '', { minlength: 1, maxlength: 10, default: profile.currentLibrary, readonly: activeProfile })
        .addInput("libraryList", vscode_1.l10n.t("Library List"), vscode_1.l10n.t("A comma-separated list of libraries."), { default: profile.libraryList.join(","), readonly: activeProfile })
        .addInput("setLibraryListCommand", vscode_1.l10n.t("Library List Command"), vscode_1.l10n.t("Library List Command can be used to set your library list based on the result of a command like <code>CHGLIBL</code>, or your own command that sets the library list.<br/>Commands should be as explicit as possible.<br/>When refering to commands and objects, both should be qualified with a library.<br/>Put <code>?</code> in front of the command to prompt it before execution."), { default: profile.setLibraryListCommand })
        .addHorizontalRule()
        .addHeading(vscode_1.l10n.t("Object filters"), 3)
        .addParagraph(objectFilters.length ? `<ul>${objectFilters.map(filter => `<li>${filter.name}</li>`).join('')}</ul>` : vscode_1.l10n.t("None"))
        .addHorizontalRule()
        .addHeading(vscode_1.l10n.t("IFS shortcuts"), 3)
        .addParagraph(ifsShortcuts.length ? `<ul>${ifsShortcuts.map(shortcut => `<li>${shortcut}</li>`).join('')}</ul>` : vscode_1.l10n.t("None"))
        .addHorizontalRule()
        .addHeading(vscode_1.l10n.t("Custom variables"), 3)
        .addParagraph(customVariables.length ? `<ul>${customVariables.map(variable => `<li>&${variable.name}: <code>${variable.value}</code></li>`).join('')}</ul>` : vscode_1.l10n.t("None"))
        .open();
    editedProfiles.add(profile.name);
}
exports.editConnectionProfile = editConnectionProfile;
async function save(profile, data) {
    const content = instantiate_1.instance.getConnection()?.getContent();
    if (content) {
        profile.homeDirectory = data.homeDirectory.trim();
        profile.setLibraryListCommand = data.setLibraryListCommand.trim();
        data.currentLibrary = data.currentLibrary.trim();
        if (data.currentLibrary) {
            if (await content.checkObject({ library: "QSYS", name: data.currentLibrary, type: "*LIB" })) {
                profile.currentLibrary = data.currentLibrary;
            }
            else {
                throw new Error(vscode_1.l10n.t("Current library {0} is invalid", data.currentLibrary));
            }
        }
        const libraryList = data.libraryList.split(',').map(library => library.trim());
        const badLibraries = await content.validateLibraryList(libraryList);
        if (badLibraries.length && !await vscode_1.default.window.showWarningMessage(vscode_1.l10n.t("The following libraries are invalid. Do you still want to save that profile?"), {
            modal: true,
            detail: badLibraries.sort().map(library => `- ${library}`).join("\n")
        }, vscode_1.l10n.t("Yes"))) {
            throw new Error(vscode_1.l10n.t("Save aborted"));
        }
        profile.libraryList = libraryList;
        await (0, connectionProfiles_1.updateConnectionProfile)(profile);
    }
}
//# sourceMappingURL=connectionProfileEditor.js.map