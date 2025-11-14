import vscode, { l10n } from "vscode";
import { getConnectionProfiles } from "../../../api/connectionProfiles";
import { instance } from "../../../instantiate";
import { ConnectionProfile } from "../../../typings";
import { VscodeTools } from "../../Tools";
import { ContextItem } from "./contextItem";

export namespace ConnectionProfiles {
  export function validateName(name: string, names: string[]) {
    if (!name) {
      return l10n.t('Name cannot be empty');
    }
    else if (names.includes(name.toLocaleUpperCase())) {
      return l10n.t("Profile {0} already exists", name);
    }
  }
}

export class ProfilesNode extends ContextItem {
  constructor() {
    super(l10n.t("Profiles"), { state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = "profilesNode";
  }

  getChildren() {
    const currentProfile = instance.getConnection()?.getConfig().currentProfile;
    return getConnectionProfiles()
      .sort((p1, p2) => p1.name.localeCompare(p2.name))
      .map(profile => new ProfileItem(this, profile, profile.name === currentProfile));
  }
}

export class ProfileItem extends ContextItem {
  static contextValue = `profileItem`;
  static activeColor = "charts.green";

  constructor(parent: ContextItem, readonly profile: ConnectionProfile, active: boolean) {
    super(profile.name, { parent, icon: "person", color: active ? ProfileItem.activeColor : undefined });

    this.contextValue = `${ProfileItem.contextValue}${active ? '_active' : ''}${profile.setLibraryListCommand ? '_command' : ''}`;
    this.description = active ? l10n.t(`Active profile`) : ``;
    this.resourceUri = vscode.Uri.from({ scheme: this.contextValue, authority: profile.name, query: active ? "active" : "" });
    this.tooltip = VscodeTools.profileToToolTip(profile)

    this.command = {
      title: "Edit connection profile",
      command: "code-for-ibmi.context.profile.edit",
      arguments: [this.profile]
    }
  }
}