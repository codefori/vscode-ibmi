import vscode, { FileDecoration, l10n, window } from "vscode";
import { stringify } from "querystring";
import { getConnectionProfilesInGroups } from "../../../api/connectionProfiles";
import { instance } from "../../../instantiate";
import { AnyConnectionProfile, ProfileState, ProfileType } from "../../../api/configuration/config/types";
import { VscodeTools } from "../../Tools";
import { EnvironmentItem } from "./environmentItem";

export namespace ConnectionProfiles {
  export function validateName(name: string, names: string[]) {
    if (!name) {
      return l10n.t('Name cannot be empty');
    }
    else if (VscodeTools.includesCaseInsensitive(names, name)) {
      return l10n.t("Profile {0} already exists", name);
    }
  }
}

export class ProfilesNode extends EnvironmentItem {
  constructor() {
    super(l10n.t("Profiles"), { icon: "account", state: vscode.TreeItemCollapsibleState.Collapsed });
    this.contextValue = "profilesNode";
  }

  async getChildren() {
    const connection = instance.getConnection();
    const config = connection?.getConfig();
    const currentProfile = config?.currentProfile;
    const currentProfileType = config?.currentProfileType ?? `local`;
    const { localProfiles, serverProfiles } = await getConnectionProfilesInGroups();
    const localProfileItems = localProfiles
      .sort((p1, p2) => p1.name.localeCompare(p2.name))
      .map(profile => new ProfileItem(this, profile, profile.name === currentProfile && profile.type === currentProfileType));
    const serverProfileItems = serverProfiles
      .sort((p1, p2) => p1.name.localeCompare(p2.name))
      .map(profile => new ProfileItem(this, profile, profile.name === currentProfile && profile.type === currentProfileType));
    return [...localProfileItems, ...serverProfileItems];
  }
}

export class ProfileItem extends EnvironmentItem {
  static activeColor = "charts.green";
  static modifiedColor = "charts.blue";
  static outOfSyncColor = "charts.yellow";
  static contextValue = `profileItem`;

  constructor(parent: EnvironmentItem, readonly profile: AnyConnectionProfile, readonly active: boolean) {
    const state = profile.type === 'server' ? profile.state : undefined;
    const icon = profile.type === 'server' ? `vm` : `person`;
    const color = ProfileItem.getColor(active, profile.type, state);
    super(profile.name, { parent, icon: icon, color });

    this.contextValue = `${ProfileItem.contextValue}${active ? '_active' : ''}${profile.setLibraryListCommand ? '_command' : ''}${profile.type === 'server' ? `_${profile.state}` : ''}`;
    this.description = active ? l10n.t(`Active profile`) : ``;
    if (active && profile.type === 'server') {
      this.description = this.description ? `${this.description} (${profile.state})` : `(${profile.state})`;
    }

    this.resourceUri = vscode.Uri.from({
      scheme: ProfileItem.contextValue,
      authority: profile.name,
      query: stringify({ active: active || undefined, type: profile.type, state: state })
    });
    this.tooltip = VscodeTools.profileToToolTip(profile);

    this.command = {
      title: "Edit connection profile",
      command: "code-for-ibmi.environment.profile.edit",
      arguments: [this.profile]
    }
  }

  static getColor(active: boolean, type: ProfileType, state?: ProfileState): string | undefined {
    if (active) {
      if (type === `server` && state) {
        switch (state) {
          case 'In Sync':
            return ProfileItem.activeColor;
          case 'Modified':
            return ProfileItem.modifiedColor;
          case 'Out of Sync':
            return ProfileItem.outOfSyncColor;
        }
      }

      return ProfileItem.activeColor;
    }
  }
}