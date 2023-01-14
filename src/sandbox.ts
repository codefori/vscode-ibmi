import { env } from "process";
import { commands, extensions, window } from "vscode";
import { ConnectionConfiguration } from "./api/Configuration";
import { GitExtension } from "./api/import/git";
import { instance } from "./instantiate";
import { ConnectionData } from "./typings";

export default async function () {

  let server: string | undefined = env.SANDBOX_SERVER;
  let username: string | undefined = env.SANDBOX_USER;
  let password: string | undefined = env.SANDBOX_PASS;

  // If Sandbox mode is enabled, then the server and username can be inherited from the branch name
  if (env.VSCODE_IBMI_SANDBOX) {
    const gitAPI = extensions.getExtension<GitExtension>(`vscode.git`)?.exports.getAPI(1);
    if (gitAPI && gitAPI.repositories && gitAPI.repositories.length > 0) {
      const repo = gitAPI.repositories[0];
      const branchName = repo.state.HEAD?.name;

      if (branchName) {
        console.log(branchName);

        const parts = branchName.split(`/`);

        switch (parts.length) {
          case 2:
            server = parts[0];
            username = parts[1].toUpperCase(); 
            break;
          case 1:
            // We don't want to overwrite the username if one is set
            username = parts[0].toUpperCase();
            break;
        }
      }
    }

    // In sandbox mode, the username and password are frequently the same
    if (username && !password) password = username.toUpperCase();
  }

  if (server && username && password) {
    const connectionData: ConnectionData = {
      host: server,
      name: `Sandbox-${username}`,
      username,
      password,
      port: 22,
      privateKey: null,
      keepaliveInterval: 35000
    };

    if (env.VSCODE_IBMI_SANDBOX) {
      console.log(`Sandbox mode enabled.`);
      window.showInformationMessage(`Thanks for trying the Code for IBM i Sandbox!`, {
        modal: true,
        detail: `You are using this system at your own risk. Do not share any sensitive or private information.`
      });
    }

    const connectionResult = await commands.executeCommand(`code-for-ibmi.connectDirect`, connectionData);

    if (connectionResult) {
      const config = instance.getConfig();
      if (config) {
        const libraryList = config.libraryList;
        if (!libraryList.includes(username)) {
          config.libraryList = [...config.libraryList, username];

          config.objectFilters.push(
            {
              name: "Sandbox Sources",
              library: username,
              object: "*",
              types: [
                "*SRCPF"
              ],
              member: "*",
              memberType: ""
            },
            {
              name: "Sandbox Object Filters",
              library: username,
              object: "*",
              types: [
                "*ALL"
              ],
              member: "*",
              memberType: ""
            },
          );

          await ConnectionConfiguration.update(config);
          commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);
          commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`);
        }
      }

    } else {
      window.showInformationMessage(`Oh no! The sandbox is down.`, {
        modal: true,
        detail: `Sorry, but the sandbox is offline right now. Try again another time.`
      });
    }
  }
} 