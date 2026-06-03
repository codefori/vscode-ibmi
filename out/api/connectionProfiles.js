"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isActiveProfile = exports.cloneProfile = exports.assignProfile = exports.getDefaultProfile = exports.getConnectionProfile = exports.getConnectionProfiles = exports.updateConnectionProfile = void 0;
const vscode_1 = require("vscode");
const instantiate_1 = require("../instantiate");
const IBMi_1 = __importDefault(require("./IBMi"));
async function updateConnectionProfile(profile, options) {
    const config = instantiate_1.instance.getConnection()?.getConfig();
    if (config) {
        const profiles = config.connectionProfiles;
        const index = profiles.findIndex(p => p.name === profile.name);
        if (options?.delete) {
            if (index < 0) {
                throw new Error(vscode_1.l10n.t("Profile {0} not found for deletion.", profile.name));
            }
            profiles.splice(index, 1);
        }
        else {
            profile.name = options?.newName || profile.name;
            profiles[index < 0 ? profiles.length : index] = profile;
        }
        if (isActiveProfile(profile)) {
            //Only update the setLibraryListCommand in the current config since the editor is the only place it can be changed
            config.setLibraryListCommand = profile.setLibraryListCommand;
        }
        await IBMi_1.default.connectionManager.update(config);
    }
}
exports.updateConnectionProfile = updateConnectionProfile;
/**
 * @returns ann arry of {@link ConnectionProfile} stored in the config; except the default profile (with a blank name), only used internally
 */
function getConnectionProfiles() {
    const config = instantiate_1.instance.getConnection()?.getConfig();
    if (config) {
        return config.connectionProfiles.filter(profile => Boolean(profile.name));
    }
    else {
        throw new Error(vscode_1.l10n.t("Not connected to an IBM i"));
    }
}
exports.getConnectionProfiles = getConnectionProfiles;
function getConnectionProfile(profileName) {
    return getConnectionProfiles().filter(p => p.name === profileName).at(0);
}
exports.getConnectionProfile = getConnectionProfile;
function getDefaultProfile() {
    const config = instantiate_1.instance.getConnection()?.getConfig();
    if (config) {
        let defaultProfile = config.connectionProfiles.filter(profile => !profile.name).at(0);
        if (!defaultProfile) {
            defaultProfile = {
                name: '',
                homeDirectory: '',
                ifsShortcuts: [],
                currentLibrary: '',
                objectFilters: [],
                customVariables: [],
                libraryList: []
            };
            config.connectionProfiles.push(defaultProfile);
        }
        return defaultProfile;
    }
    else {
        throw new Error(vscode_1.l10n.t("Not connected to an IBM i"));
    }
}
exports.getDefaultProfile = getDefaultProfile;
function assignProfile(fromProfile, toProfile) {
    toProfile.homeDirectory = fromProfile.homeDirectory;
    toProfile.currentLibrary = fromProfile.currentLibrary;
    toProfile.libraryList = fromProfile.libraryList;
    toProfile.objectFilters = fromProfile.objectFilters;
    toProfile.ifsShortcuts = fromProfile.ifsShortcuts;
    toProfile.customVariables = fromProfile.customVariables;
    toProfile.setLibraryListCommand = fromProfile.setLibraryListCommand;
    return toProfile;
}
exports.assignProfile = assignProfile;
function cloneProfile(fromProfile, newName) {
    return assignProfile(fromProfile, { name: newName });
}
exports.cloneProfile = cloneProfile;
function isActiveProfile(profile) {
    return instantiate_1.instance.getConnection()?.getConfig().currentProfile === profile.name;
}
exports.isActiveProfile = isActiveProfile;
//# sourceMappingURL=connectionProfiles.js.map