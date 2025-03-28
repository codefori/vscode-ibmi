import { env } from "process";
import querystring from "querystring";
import { commands, l10n, window } from "vscode";
import IBMi from "../../api/IBMi";
import { instance } from "../../instantiate";
import { ConnectionData } from "../../typings";
import { VscodeTools } from "../../ui/Tools";
import { Code4iUriHandler } from "../handler";

/**
 * Handles /connect with the following query parameters:
 *  - `server`: the IBM i to connect to
 *  - `user`: an IBM i user profile
 *  - `pass`: the profile's password
 *  - `save` (optional): whether or not this connection should be saved
 */
export const sandboxURIHandler: Code4iUriHandler = {
  canHandle: (path) => path === `/connect`,
  async handle(uri, connection) {
    if (!connection) {
      const queryData = querystring.parse(uri.query);

      const save = queryData.save === `true`;
      const server = String(queryData.server);
      let user: string | string[] | undefined = queryData.user;
      let pass: string | string[] | undefined = queryData.pass;

      if (server) {
        if (user && Array.isArray(user)) {
          user = user[0];
        }
        else if (!user) {
          user = await window.showInputBox({
            title: l10n.t(`User for server`),
            prompt: l10n.t(`Enter username for {0}`, server)
          });
        }

        if (pass) {
          pass = Buffer.from(String(pass), `base64`).toString();
        } else {
          pass = await window.showInputBox({
            password: true,
            title: l10n.t(`Password for server`),
            prompt: l10n.t(`Enter password for {0}@{1}`, String(user), server)
          });
        }

        if (user && pass) {
          const serverParts = String(server).split(`:`);
          const host = serverParts[0];
          const port = serverParts.length === 2 ? Number(serverParts[1]) : 22;

          const connectionData: ConnectionData = {
            host,
            name: `${user}-${host}`,
            username: String(user),
            password: String(pass),
            port
          };

          const connectionResult = await commands.executeCommand<boolean>(`code-for-ibmi.connectDirect`, connectionData);
          if (connectionResult) {
            await initialSetup(connectionData.username);

            if (save) {
              const existingConnection = IBMi.connectionManager.getByName(connectionData.name);

              if (!existingConnection) {
                // New connection!
                await IBMi.connectionManager.storeNew(connectionData);
              }
            }

          } else {
            window.showInformationMessage(l10n.t(`Failed to connect`), {
              modal: true,
              detail: l10n.t("Failed to connect to {0} as {1}", server, String(user))
            });
          }

        } else {
          window.showErrorMessage(l10n.t(`Connection to {0} ended as no password was provided.`, server));
        }
      }
    } else {
      window.showInformationMessage(l10n.t(`Failed to connect`), {
        modal: true,
        detail: l10n.t(`This Visual Studio Code instance is already connected to a server.`)
      });
    }
  },
}

export async function initializeSandbox() {

  let server: string | undefined = env.SANDBOX_SERVER;
  let username: string | undefined = env.SANDBOX_USER;
  let password: string | undefined = env.SANDBOX_PASS;

  // If Sandbox mode is enabled, then the server and username can be inherited from the branch name
  if (env.VSCODE_IBMI_SANDBOX) {
    try {
      const gitAPI = VscodeTools.getGitAPI();
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
      window.showInformationMessage(l10n.t(`Thanks for trying the Code for IBM i Sandbox!`), {
        modal: true,
        detail: l10n.t(`You are using this system at your own risk. Do not share any sensitive or private information.`)
      });
    }

    const connectionResult = await commands.executeCommand(`code-for-ibmi.connectDirect`, connectionData);

    if (connectionResult) {
      await initialSetup(connectionData.username);

    } else {
      window.showInformationMessage(l10n.t(`Oh no! The sandbox is down.`), {
        modal: true,
        detail: l10n.t(`Sorry, but the sandbox is offline right now. Try again another time.`)
      });
    }
  }
}

async function initialSetup(username: string) {
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
        }
      );

      await IBMi.connectionManager.update(config);
      commands.executeCommand(`code-for-ibmi.refreshLibraryListView`);
      commands.executeCommand(`code-for-ibmi.refreshObjectBrowser`);
    }
  }

  await commands.executeCommand(`helpView.focus`);
}