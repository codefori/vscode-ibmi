import { env } from "process";
import querystring from "querystring";
import { commands, ExtensionContext, Uri, window } from "vscode";
import { ConnectionConfiguration, ConnectionManager, GlobalConfiguration } from "./api/Configuration";
import { Tools } from "./api/Tools";
import { instance } from "./instantiate";
import { t } from "./locale";
import { ConnectionData } from "./typings";

export async function handleSandboxStartup() {

  let server: string | undefined = env.SANDBOX_SERVER;
  let username: string | undefined = env.SANDBOX_USER;
  let password: string | undefined = env.SANDBOX_PASS;

  // If Sandbox mode is enabled, then the server and username can be inherited from the branch name
  if (env.VSCODE_IBMI_SANDBOX) {
    try {
      const gitAPI = Tools.getGitAPI();
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
    } catch (e) {
      console.log(`Git extension issue.`);
      console.log(e);
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
      port: 22
    };

    if (env.VSCODE_IBMI_SANDBOX) {
      console.log(`Sandbox mode enabled.`);
      window.showInformationMessage(t(`sandbox.connected.modal.title`), {
        modal: true,
        detail: t(`sandbox.connected.modal.detail`)
      });
    }

    const connectionResult = await commands.executeCommand(`code-for-ibmi.connectDirect`, connectionData);

    if (connectionResult) {
      await initialSandboxSetup(connectionData.username);

    } else {
      window.showInformationMessage(t(`sandbox.noconnection.modal.title`), {
        modal: true,
        detail: t(`sandbox.noconnection.modal.detail`)
      });
    }
  }
}

export async function initialSandboxSetup(username: string) {
  const config = instance.getConfig();
  if (config) {
    const libraryList = config.libraryList;
    if (!libraryList.includes(username)) {
      config.libraryList = [...config.libraryList, username];

      config.objectFilters.push(
        {
          name: "Sandbox Sources",
          filterType: 'simple',
          library: username,
          object: "*",
          types: [
            "*SRCPF"
          ],
          member: "*",
          memberType: "",
          protected: false
        },
        {
          name: "Sandbox Object Filters",
          filterType: 'simple',
          library: username,
          object: "*",
          types: [
            "*ALL"
          ],
          member: "*",
          memberType: "",
          protected: false
        },
      );

      await ConnectionConfiguration.update(config);
      commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);
      commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`);
    }
  }

  await commands.executeCommand(`helpView.focus`);
}