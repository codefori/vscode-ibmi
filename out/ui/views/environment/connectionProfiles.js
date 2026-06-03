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
exports.ProfileItem = exports.ProfilesNode = exports.ConnectionProfiles = void 0;
const vscode_1 = __importStar(require("vscode"));
const connectionProfiles_1 = require("../../../api/connectionProfiles");
const instantiate_1 = require("../../../instantiate");
const Tools_1 = require("../../Tools");
const environmentItem_1 = require("./environmentItem");
var ConnectionProfiles;
(function (ConnectionProfiles) {
    function validateName(name, names) {
        if (!name) {
            return vscode_1.l10n.t('Name cannot be empty');
        }
        else if (Tools_1.VscodeTools.includesCaseInsensitive(names, name)) {
            return vscode_1.l10n.t("Profile {0} already exists", name);
        }
    }
    ConnectionProfiles.validateName = validateName;
})(ConnectionProfiles = exports.ConnectionProfiles || (exports.ConnectionProfiles = {}));
class ProfilesNode extends environmentItem_1.EnvironmentItem {
    constructor() {
        super(vscode_1.l10n.t("Profiles"), { icon: "account", state: vscode_1.default.TreeItemCollapsibleState.Collapsed });
        this.contextValue = "profilesNode";
    }
    getChildren() {
        const currentProfile = instantiate_1.instance.getConnection()?.getConfig().currentProfile;
        return (0, connectionProfiles_1.getConnectionProfiles)()
            .sort((p1, p2) => p1.name.localeCompare(p2.name))
            .map(profile => new ProfileItem(this, profile, profile.name === currentProfile));
    }
}
exports.ProfilesNode = ProfilesNode;
class ProfileItem extends environmentItem_1.EnvironmentItem {
    profile;
    static contextValue = `profileItem`;
    static activeColor = "charts.green";
    constructor(parent, profile, active) {
        super(profile.name, { parent, icon: "person", color: active ? ProfileItem.activeColor : undefined });
        this.profile = profile;
        this.contextValue = `${ProfileItem.contextValue}${active ? '_active' : ''}${profile.setLibraryListCommand ? '_command' : ''}`;
        this.description = active ? vscode_1.l10n.t(`Active profile`) : ``;
        this.resourceUri = vscode_1.default.Uri.from({ scheme: this.contextValue, authority: profile.name, query: active ? "active" : "" });
        this.tooltip = Tools_1.VscodeTools.profileToToolTip(profile);
        this.command = {
            title: "Edit connection profile",
            command: "code-for-ibmi.environment.profile.edit",
            arguments: [this.profile]
        };
    }
}
exports.ProfileItem = ProfileItem;
//# sourceMappingURL=connectionProfiles.js.map