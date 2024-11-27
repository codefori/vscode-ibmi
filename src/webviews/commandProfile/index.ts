import { commands, window } from "vscode";
import { ConnectionConfiguration, GlobalConfiguration } from "../../api/Configuration";
import { CustomUI } from "../../api/CustomUI";
import { instance } from "../../instantiate";

export class CommandProfile {
  static async show(currentName?: string) {
    const connection = instance.getConnection()!;
    let config = connection.getConfig();

    let currentSettings: ConnectionConfiguration.CommandProfile = {
      name: ``,
      command: ``
    };

    if (currentName) {
      const storedSettings = config?.commandProfiles.find(profile => profile.name === currentName);
      if (storedSettings) {
        currentSettings = storedSettings;
      }
    }

    const page = await new CustomUI()
    .addParagraph(`Command Profiles can be used to set your library list based on the result of a command like <code>CHGLIBL</code>, or your own command that sets the library list. Commands should be as explicit as possible. When refering to commands and objects, both should be qualified with a library.`)
    .addInput(`name`, `Name`, `Name of the Command Profile`, {default: currentSettings.name})
    .addInput(`command`, `Command`, `Command to be executed that will set the library list`, {default: currentSettings.command})
    .addButtons(
      { id: `save`, label: `Save` },
      { id: `cancel`, label: `Cancel` }
    )
    .loadPage<any>(`Command Profile`);

    if (page && page.data) {
      if (page.data.buttons !== `cancel`) {
        if (page.data.name && page.data.command) {
          if (currentName) {
            const oldIndex = config?.commandProfiles.findIndex(profile => profile.name === currentName);

            if (oldIndex !== undefined) {
              config!.commandProfiles[oldIndex] = page.data;
            } else {
              config!.commandProfiles.push(page.data);
            }
          } else {
            config!.commandProfiles.push(page.data);
          }

          await ConnectionConfiguration.update(config!);
          commands.executeCommand(`code-for-ibmi.refreshProfileView`);

        } else {
          // Bad name. Do nothing?
          window.showWarningMessage(`A valid name and command is required for Command Profiles.`);
        }
      }

      page.panel.dispose();
    }
  }
}