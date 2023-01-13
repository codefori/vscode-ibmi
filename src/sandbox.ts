import { env } from "process";
import { commands, extensions, window } from "vscode";
import { ConnectionConfiguration } from "./api/Configuration";
import { GitExtension } from "./api/import/git";
import { instance } from "./instantiate";
import { ConnectionData } from "./typings";

export default async function () {
  if (env.VSCODE_IBMI_SANDBOX && env.SANDBOX_SERVER) {
    console.log(`Sandbox mode enabled. Look at branch name as username`);
    const gitAPI = extensions.getExtension<GitExtension>(`vscode.git`)?.exports.getAPI(1);
    if (gitAPI && gitAPI.repositories && gitAPI.repositories.length > 0) {
      const repo = gitAPI.repositories[0];
      const branchName = repo.state.HEAD?.name;

      if (branchName) {
        console.log(`${env.SANDBOX_SERVER}@${branchName}:${branchName}`);

        const username = branchName.toUpperCase();

        const connectionData: ConnectionData = {
          host: env.SANDBOX_SERVER,
          name: `Sandbox-${username}`,
          username: username,
          password: username,
          port: 22,
          privateKey: null,
          keepaliveInterval: 35000
        };

        window.showInformationMessage(`Thanks for trying the Code for IBM i Sandbox!`, {
          modal: true,
          detail: `You are using this system at your own risk. Do not share any sensitive or private information.`
        });
        
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
          window.showInformationMessage(`Ohno! The sandbox is down.`, {
            modal: true,
            detail: `Sorry, but the sandbox is offline right now. Try again another time.`
          });
        }
      }
    }
  }
} 