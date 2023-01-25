import { ExtensionContext, Uri } from "vscode";
import Instance from "../Instance";

import * as vscode from 'vscode';
import path from "path";

import * as certificates from "./certificates";
import * as server from "./server";

const ptfContext = `code-for-ibmi:debug.ptf`;
const remoteCertContext = `code-for-ibmi:debug.remote`;
const localCertContext = `code-for-ibmi:debug.local`;

/**
 * @param {*} instance 
 * @param {vscode.ExtensionContext} context 
 */
export async function initialise(instance: Instance, context: ExtensionContext) {
  const startDebugging = (options: DebugOptions) => {
    exports.startDebug(instance, options);
  }

  /** @param {vscode.Uri} uri */
  const getObjectFromUri = (uri: Uri) => {
    /** @type {IBMi} */
    const connection = instance.getConnection();

    /** @type {Configuration} */
    const configuration = instance.getConfig();

    const qualifiedPath: {
      library: string | undefined,
      object: string | undefined
    } = { library: undefined, object: undefined };

    if (connection && configuration) {

      switch (uri.scheme) {
        case `member`:
          const memberPath = connection.parserMemberPath(uri.path);
          qualifiedPath.library = memberPath.library;
          qualifiedPath.object = memberPath.member;
          break;
        case `streamfile`:
        case `file`:
          const parsedPath = path.parse(uri.path);
          qualifiedPath.library = configuration.currentLibrary;
          qualifiedPath.object = parsedPath.name;
          break;
      }

      if (qualifiedPath.object) {
        // Remove .pgm ending potentially
        qualifiedPath.object = qualifiedPath.object.toUpperCase();
        if (qualifiedPath.object.endsWith(`.PGM`))
          qualifiedPath.object = qualifiedPath.object.substring(0, qualifiedPath.object.length - 4);
      }
    }

    return qualifiedPath;
  }

  const getPassword = async () => {
    /** @type {IBMi} */
    const connection = instance.getConnection();

    let password = await context.secrets.get(`${connection!.currentConnectionName}_password`);
    if (!password) {
      password = await vscode.window.showInputBox({
        password: true,
        prompt: `Password for user profile ${connection!.currentUser} is required to debug.`
      });
    }

    return password;
  }

  const debugPTFInstalled = async () => {
    const connection = instance.getConnection();
    return connection?.remoteFeatures[`startDebugService.sh`] !== undefined;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(`code-for-ibmi.debug.activeEditor`, async () => {
      const connection = instance.connection;
      if (connection) {
        if (connection.remoteFeatures[`startDebugService.sh`]) {
          const activeEditor = vscode.window.activeTextEditor;

          if (activeEditor) {
            const qualifiedObject = getObjectFromUri(activeEditor.document.uri);
            const password = await getPassword();

            if (password && qualifiedObject.library && qualifiedObject.object) {
              const debugOpts: DebugOptions = {
                password,
                library: qualifiedObject.library,
                object: qualifiedObject.object
              };

              startDebugging(debugOpts);
            }
          }
        } else {
          const openTut = await vscode.window.showInformationMessage(`Looks like you do not have the debug PTF installed. Do you want to see the Walkthrough to set it up?`, `Take me there`);
          if (openTut === `Take me there`) {
            vscode.commands.executeCommand(`workbench.action.openWalkthrough`, `halcyontechltd.vscode-ibmi-walkthroughs#code-ibmi-debug`);
          }
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.debug.setup.remote`, async () => {
      const connection = instance.connection;
      if (connection) {
        const ptfInstalled = await debugPTFInstalled();

        if (ptfInstalled) {
          const remoteExists = await certificates.checkRemoteExists(connection);
          let remoteCertsAreNew = false;
          let remoteCertsOk = false;

          if (remoteExists) {
            remoteCertsOk = true;
          } else {
            const doSetup = await vscode.window.showInformationMessage(`Debug setup`, {
              modal: true,
              detail: `Debug certificates are not setup on the system. Continue with setup?`
            }, `Continue`);

            if (doSetup) {
              try {
                await certificates.setup(connection);
                remoteCertsOk = true;
                remoteCertsAreNew = true;
              } catch (e: any) {
                vscode.window.showErrorMessage(e.message || e);
              }
            }
          }

          if (remoteCertsOk) {
            vscode.commands.executeCommand(`setContext`, remoteCertContext, true);
            vscode.commands.executeCommand(`code-for-ibmi.debug.setup.local`, remoteCertsAreNew);
          }
        } else {
          vscode.window.showErrorMessage(`Debug PTF not installed.`);
        }

      } else {
        vscode.window.showErrorMessage(`No connection to IBM i available.`);
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.debug.setup.local`, async (force: boolean = false) => {
      const connection = instance.connection;

      if (connection) {
        const ptfInstalled = await debugPTFInstalled();

        if (ptfInstalled) {
          const localExists = await certificates.checkLocalExists(connection);
          let localCertsOk = false;

          if (localExists && !force) {
            localCertsOk = true;
          } else {
            try {
              await certificates.downloadToLocal(connection);
              localCertsOk = true;
            } catch (e: any) {
              vscode.window.showErrorMessage(`Failed to download new local debug certificate`);
            }
          }

          if (localCertsOk) {
            vscode.commands.executeCommand(`setContext`, localCertContext, true);
          }
        } else {
          vscode.window.showErrorMessage(`Debug PTF not installed.`);
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.debug.start`, async () => {
      const connection = instance.connection;
      if (connection) {
        const ptfInstalled = await debugPTFInstalled();
        if (ptfInstalled) {
          const remoteExists = await certificates.checkRemoteExists(connection);
          if (remoteExists) {

            const localExists = await certificates.checkLocalExists(connection);
            if (localExists) {
              vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async (progress) => {

                let startupService = false;

                progress.report({ increment: 25, message: `Checking if service is already running.` });
                const isRunning = await server.isRunning(connection.config?.debugPort || "8005", instance.content!);

                if (isRunning) {
                  const confirmEndServer = await vscode.window.showInformationMessage(`Starting debug server`, {
                    detail: `Looks like the debug service is currently running. Do you want to end it to start a new instance?`,
                    modal: true
                  }, `End service`);
                  
                  if (confirmEndServer === `End service`) {
                    progress.report({ increment: 25, message: `Ending service if it is already running.` });
                    const endResult = await server.end(connection);
                    startupService = true;
                  }
                } else {
                  startupService = true;
                }

                if (startupService) {
                  progress.report({ increment: 25, message: `Starting service up.` });
                  await server.startup(connection);
                } else {
                  vscode.window.showInformationMessage(`Cancelled startup of debug service.`);
                }
              })

            } else {
              const localResult = await vscode.window.showErrorMessage(`Local debug certificate does not exist.`, `Setup`);
              if (localResult === `Setup`) {
                vscode.commands.executeCommand(`code-for-ibmi.debug.setup.local`);
              }
            }

          } else {
            vscode.commands.executeCommand(`code-for-ibmi.debug.setup.remote`);
          }
        } else {
          vscode.window.showErrorMessage(`Debug PTF not installed.`);
        }
      }
    })
  );

  // Run during startup:

  if (instance.connection) {
    if (instance.connection.remoteFeatures[`startDebugService.sh`]) {
      vscode.commands.executeCommand(`setContext`, ptfContext, true);

      const remoteCerts = await certificates.checkRemoteExists(instance.connection);

      if (remoteCerts) {
        vscode.commands.executeCommand(`setContext`, remoteCertContext, true);

        const localExists = await certificates.checkLocalExists(instance.connection);

        if (localExists) {
          vscode.commands.executeCommand(`setContext`, localCertContext, true);
        } else {
          vscode.commands.executeCommand(`code-for-ibmi.debug.setup.local`);
        }
      } else {
        const openTut = await vscode.window.showInformationMessage(`Looks like you have the debug PTF installed. Do you want to see the Walkthrough to set it up?`, `Take me there`);
        if (openTut === `Take me there`) {
          vscode.commands.executeCommand(`workbench.action.openWalkthrough`, `halcyontechltd.vscode-ibmi-walkthroughs#code-ibmi-debug`)
        }
      }
    }
  }

}

interface DebugOptions {
  password: string;
  library: string;
  object: string;
};

export async function startDebug(instance: Instance, options: DebugOptions) {
  const connection = instance.getConnection();
  const config = instance.getConfig();
  const storage = instance.getStorage();

  const port = config?.debugPort;
  const updateProductionFiles = config?.debugUpdateProductionFiles;
  const enableDebugTracing = config?.debugEnableDebugTracing; // TODO: configurable

  const secure = config?.debugSecure; // TODO: make configurable

  if (secure) {
    process.env[`DEBUG_CA_PATH`] = certificates.getLocalCert(connection!);
  }

  const pathKey = options.library.trim() + `/` + options.object.trim();

  const previousCommands = storage!.getDebugCommands();

  let currentCommand: string | undefined = previousCommands[pathKey] || `CALL PGM(` + pathKey + `)`;

  currentCommand = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    title: `Debug command`,
    prompt: `Command used to start debugging. The command is wrapped around SBMJOB.`,
    value: currentCommand
  });

  if (currentCommand) {
    previousCommands[pathKey] = currentCommand;
    storage?.setDebugCommands(previousCommands);

    const debugConfig = {
      "type": `IBMiDebug`,
      "request": `launch`,
      "name": `Remote debug: Launch a batch debug session`,
      "user": connection!.currentUser.toUpperCase(),
      "password": options.password,
      "host": connection!.currentHost,
      "port": port,
      "secure": secure,  // Enforce secure mode
      "ignoreCertificateErrors": !secure,
      "library": options.library.toUpperCase(),
      "program": options.object.toUpperCase(),
      "startBatchJobCommand": `SBMJOB CMD(${currentCommand}) INLLIBL(${config?.libraryList.join(` `)}) CURLIB(${config?.currentLibrary})`,
      "updateProductionFiles": updateProductionFiles,
      "trace": enableDebugTracing,
    };

    vscode.debug.startDebugging(undefined, debugConfig, undefined);
  }
}