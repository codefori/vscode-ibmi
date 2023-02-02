import { env } from "process";
import querystring from "querystring";
import { commands, ExtensionContext, extensions, Uri, window } from "vscode";
import { ConnectionConfiguration, GlobalConfiguration } from "./api/Configuration";
import { GitExtension } from "./api/import/git";
import { Tools } from "./api/Tools";
import { instance } from "./instantiate";
import { ConnectionData } from "./typings";

export async function registerUriHandler(context: ExtensionContext) {
  context.subscriptions.push(
    window.registerUriHandler({
      async handleUri(uri: Uri) {
        console.log(uri);

        const connection = instance.getConnection();

        switch (uri.path) {
          case `/connect`:
            if (connection === undefined) {
              const queryData = querystring.parse(uri.query);

              const save = queryData.save === `true`;
              const server = queryData.server;
              let user: string | string[] | undefined = queryData.user;
              let pass: string | string[] | undefined = queryData.pass;

              if (server) {
                if (!user) {
                  user = await window.showInputBox({
                    title: `User for server`,
                    prompt: `Enter username for ${server}`
                  });
                }

                if (pass) {
                  pass = Buffer.from(String(pass), `base64`).toString();
                } else {
                  pass = await window.showInputBox({
                    password: true,
                    title: `Password for server`,
                    prompt: `Enter password for ${user}@${server}`
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
                    port,
                    privateKey: null
                  };

                  const connectionResult = await commands.executeCommand(`code-for-ibmi.connectDirect`, connectionData);

                  if (connectionResult) {
                    await initialSetup(connectionData.username);

                    if (save) {
                      let existingConnections: ConnectionData[] | undefined = GlobalConfiguration.get(`connections`);

                      if (existingConnections) {
                        const existingConnection = existingConnections.find(item => item.name === host);

                        if (!existingConnection) {
                          // New connection!
                          existingConnections.push({
                            ...connectionData,
                            password: undefined, // Removes the password from the object
                          });

                          context.secrets.store(`${host}_password`, pass);

                          await GlobalConfiguration.set(`connections`, existingConnections);
                        }
                      }
                    }

                  } else {
                    window.showInformationMessage(`Failed to connect`, {
                      modal: true,
                      detail: `Failed to connect to ${server} as ${user}.`
                    });
                  }

                } else {
                  window.showErrorMessage(`Connection to ${server} ended as no password was provided.`);
                }
              }
            } else {
              window.showInformationMessage(`Failed to connect`, {
                modal: true,
                detail: `This Visual Studio Code instance is already connected to a server.`
              });
            }

            break;
        }

      }
    })
  );
}

export async function handleStartup() {

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
      port: 22,
      privateKey: null
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
      await initialSetup(connectionData.username);

    } else {
      window.showInformationMessage(`Oh no! The sandbox is down.`, {
        modal: true,
        detail: `Sorry, but the sandbox is offline right now. Try again another time.`
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

  await commands.executeCommand(`helpView.focus`);
}