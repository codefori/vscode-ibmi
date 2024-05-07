import querystring from "querystring";
import { commands, ExtensionContext, Uri, window } from "vscode";
import { GlobalConfiguration } from "../api/Configuration";
import { instance } from "../instantiate";
import { t } from "../locale";
import { ConnectionData } from "../typings";
import { initialSandboxSetup } from "../sandbox";

export async function registerUriHandler(context: ExtensionContext) {
  context.subscriptions.push(
    window.registerUriHandler({
      async handleUri(uri: Uri) {
        const queryData = querystring.parse(uri.query);

        const connection = instance.getConnection();

        switch (uri.path) {
          case '/open':
            if (connection) {
              if (queryData.path) {
                if (queryData.host) {
                  const host = Array.isArray(queryData.host) ? queryData.host[0] : queryData.host;
                  if (host !== connection.currentHost) {
                    // TODO: host does not match requested host, do you still want to open?
                    return;
                  }
                }

                const paths = Array.isArray(queryData.path) ? queryData.path : [queryData.path];
                for (const path of paths) {
                  commands.executeCommand(`code-for-ibmi.openEditable`, path);
                }
              } else {
                // TODO: error message: missing path
              }
            } else {
              // TODO: error message: no connection
            }
            break;
          case `/connect`:
            if (connection === undefined) {
              const save = queryData.save === `true`;
              const server = String(queryData.server);
              let user: string | string[] | undefined = queryData.user;
              let pass: string | string[] | undefined = queryData.pass;

              if (server) {
                if (!user) {
                  user = await window.showInputBox({
                    title: t(`sandbox.input.user.title`),
                    prompt: t(`sandbox.input.user.prompt`, server)
                  });
                }

                if (pass) {
                  pass = Buffer.from(String(pass), `base64`).toString();
                } else {
                  pass = await window.showInputBox({
                    password: true,
                    title: t(`sandbox.input.password.title`),
                    prompt: t(`sandbox.input.password.prompt`, String(user), server)
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

                  const connectionResult = await commands.executeCommand(`code-for-ibmi.connectDirect`, connectionData);

                  if (connectionResult) {
                    await initialSandboxSetup(connectionData.username);

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

                          await context.secrets.store(`${host}_password`, pass);
                          await GlobalConfiguration.set(`connections`, existingConnections);
                        }
                      }
                    }

                  } else {
                    window.showInformationMessage(t(`sandbox.failedToConnect.title`), {
                      modal: true,
                      detail: t(`sandbox.failedToConnect`, server, user)
                    });
                  }

                } else {
                  window.showErrorMessage(t(`sandbox.noPassword`, server));
                }
              }
            } else {
              window.showInformationMessage(t(`sandbox.failedToConnect.title`), {
                modal: true,
                detail: t(`sandbox.alreadyConnected`)
              });
            }

            break;
        }

      }
    })
  );
}