import { ExtensionContext, Uri } from "vscode";
import Instance from "../Instance";

import * as vscode from 'vscode';
import path from "path";

import * as certificates from "./certificates";
import * as server from "./server";
import { copyFileSync } from "fs";
import { instance } from "../../instantiate";

const debugExtensionId = `IBM.ibmidebug`;

const ptfContext = `code-for-ibmi:debug.ptf`;
const remoteCertContext = `code-for-ibmi:debug.remote`;
const localCertContext = `code-for-ibmi:debug.local`;

let connectionConfirmed = false;
let temporaryPassword: string | undefined;

export async function initialize(context: ExtensionContext) {
  const debugExtensionAvailable = () => {
    const debugclient = vscode.extensions.getExtension(debugExtensionId);
    return debugclient !== undefined;
  }

  const startDebugging = (options: DebugOptions) => {
    startDebug(instance, options);
  }

  const getObjectFromUri = (uri: Uri) => {
    const connection = instance.getConnection();

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
          qualifiedPath.object = memberPath.name;
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
    const connection = instance.getConnection();

    let password = await context.secrets.get(`${connection!.currentConnectionName}_password`);

    if (!password) {
      password = temporaryPassword;
    }

    if (!password) {
      password = await vscode.window.showInputBox({
        password: true,
        prompt: `Password for user profile ${connection!.currentUser} is required to debug. Password is not stored on device, but is stored temporarily for this connection.`
      });

      // Store for later
      temporaryPassword = password;
    }

    return password;
  }

  const debugPTFInstalled = () => {
    const connection = instance.getConnection();
    return connection?.remoteFeatures[`startDebugService.sh`] !== undefined;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(`code-for-ibmi.debug.extension`, () => {
      vscode.commands.executeCommand('extension.open', debugExtensionId);
    }),

    vscode.commands.registerCommand(`code-for-ibmi.debug.endDebug`, () => {
      return vscode.debug.stopDebugging();
    }),

    vscode.debug.onDidTerminateDebugSession(async session => {
      if (session.configuration.type === `IBMiDebug`) {
        const connection = instance.getConnection();

        server.getStuckJobs(connection?.currentUser!, instance.getContent()!).then(jobIds => {
          if (jobIds.length > 0) {
            vscode.window.showInformationMessage(`You have ${jobIds.length} debug job${jobIds.length !== 1 ? `s` : ``} stuck at MSGW under your user profile.`, `End jobs`, `Ignore`)
              .then(selection => {
                if (selection === `End jobs`) {
                  server.endJobs(jobIds, connection!);
                }
              })
          }
        });
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.debug.activeEditor`, async () => {
      if (debugExtensionAvailable()) {
        const connection = instance.getConnection();
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

      } else {
        vscode.window.showInformationMessage(`Debug extension missing`, {
          detail: `The IBM i Debug extension is not installed. It can be installed from the Marketplace.`,
          modal: true
        }, `Go to Marketplace`).then(result => {
          if (result === `Go to Marketplace`) {
            vscode.commands.executeCommand('code-for-ibmi.debug.extension');
          }
        });
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.debug.setup.remote`, async () => {
      const connection = instance.getConnection();
      if (connection) {
        const ptfInstalled = debugPTFInstalled();

        if (ptfInstalled) {
          const remoteExists = await certificates.checkRemoteExists(connection);
          let remoteCertsAreNew = false;
          let remoteCertsOk = false;

          if (remoteExists) {
            vscode.window.showInformationMessage(`Certificates already exist on the server.`);
            remoteCertsOk = true;
          } else {

          }

          const doSetup = await vscode.window.showInformationMessage(`Debug setup`, {
            modal: true,
            detail: `${remoteExists
              ? `Debug certificates already exist on this system! Running this setup will overwrite them, which will require the debug service to be restarted.`
              : `Debug certificates are not setup on the system.`
              } Continue with setup?`
          }, `Continue`);

          if (doSetup) {
            try {
              await certificates.setup(connection);
              vscode.window.showInformationMessage(`Certificates successfully generated on server.`);
              remoteCertsOk = true;
              remoteCertsAreNew = true;
            } catch (e: any) {
              vscode.window.showErrorMessage(e.message || e);
            }
          }

          if (remoteCertsOk) {
            vscode.commands.executeCommand(`setContext`, remoteCertContext, true);
          }
        } else {
          vscode.window.showErrorMessage(`Debug PTF not installed.`);
        }

      } else {
        vscode.window.showErrorMessage(`No connection to IBM i available.`);
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.debug.setup.local`, async () => {
      const connection = instance.getConnection();

      if (connection) {
        const ptfInstalled = debugPTFInstalled();

        if (ptfInstalled) {
          let localCertsOk = false;
          if (connection.config!.debugIsSecure) {
            const selection = await vscode.window.showInformationMessage(
              `Client certificate`,
              {
                modal: true,
                detail: `To debug securely, a client certificate needs to be imported.`
              },
              `Import certificate`
            );

            if (selection === `Import certificate`) {
              const selectedFile = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                title: `Select client certificate`
              });

              if (selectedFile && selectedFile.length === 1) {
                try {
                  copyFileSync(selectedFile[0].fsPath, certificates.getLocalCertPath(connection));
                  localCertsOk = true;
                  vscode.window.showInformationMessage(`Certificate imported.`);
                } catch (e) {
                  vscode.window.showErrorMessage(`Failed to import local certificate.`);
                }
              }
            }
          } else {
            vscode.window.showWarningMessage(`Certificates can only be imported when secure mode is enabled.`, `Open configuration`).then(result => {
              if (result === `Open configuration`) {
                vscode.commands.executeCommand(`code-for-ibmi.showAdditionalSettings`, undefined, `Debugger`);
              }
            });
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
      const connection = instance.getConnection();
      if (connection) {
        const ptfInstalled = debugPTFInstalled();
        if (ptfInstalled) {
          const remoteExists = await certificates.checkRemoteExists(connection);
          if (remoteExists) {

            vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async (progress) => {

              let startupService = false;


              progress.report({ increment: 33, message: `Checking if service is already running.` });
              const existingDebugService = await server.getRunningJob(connection.config?.debugPort || "8005", instance.getContent()!);

              if (existingDebugService) {
                const confirmEndServer = await vscode.window.showInformationMessage(`Starting debug service`, {
                  detail: `Looks like the debug service is currently running under ${existingDebugService}. Do you want to end it to start a new instance?`,
                  modal: true
                }, `End service`);

                if (confirmEndServer === `End service`) {
                  progress.report({ increment: 33, message: `Ending currently running service.` });
                  try {
                    await server.end(connection);
                    startupService = true;
                  } catch (e: any) {
                    vscode.window.showErrorMessage(`Failed to end existing debug service (${e.message})`);
                  }
                }
              } else {
                startupService = true;
              }

              if (startupService) {
                progress.report({ increment: 34, message: `Starting service up.` });
                try {
                  await server.startup(connection);
                } catch (e: any) {
                  vscode.window.showErrorMessage(`Failed to start debug service (${e.message})`);
                }
              } else {
                vscode.window.showInformationMessage(`Cancelled startup of debug service.`);
              }
            })

          } else {
            vscode.commands.executeCommand(`code-for-ibmi.debug.setup.remote`);
          }
        } else {
          vscode.window.showErrorMessage(`Debug PTF not installed.`);
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.debug.stop`, async () => {
      const connection = instance.getConnection();
      if (connection) {
        const ptfInstalled = debugPTFInstalled();
        if (ptfInstalled) {
          vscode.window.withProgress({location: vscode.ProgressLocation.Notification}, async (progress) => {
            progress.report({message: `Ending Debug Service`});
            await server.stop(connection);
          });
        }
      }
    })
  );

  // Run during startup:
  instance.onEvent("connected", async () => {
    const connection = instance.getConnection();
    const content = instance.getContent();
    if (connection && content && connection?.remoteFeatures[`startDebugService.sh`]) {
      vscode.commands.executeCommand(`setContext`, ptfContext, true);

      const remoteCertsExist = await certificates.checkRemoteExists(connection);

      if (remoteCertsExist) {
        vscode.commands.executeCommand(`setContext`, remoteCertContext, true);

        if (connection.config!.debugIsSecure) {
          const localCertsExists = await certificates.checkLocalExists(connection);

          if (localCertsExists) {
            vscode.commands.executeCommand(`setContext`, localCertContext, true);
          } else {
            vscode.commands.executeCommand(`code-for-ibmi.debug.setup.local`);
          }
        }
      } else {
        const existingDebugService = await server.getRunningJob(connection.config?.debugPort || "8005", instance.getContent()!);
        if (existingDebugService) {
          const openSettings = await vscode.window.showInformationMessage(`Looks like the Debug Service is already running, but couldn't find the certificates in the configuration location.`, `Open settings`);
          if (openSettings === `Open settings`) {
            // Open directory to the debugger tab
            vscode.commands.executeCommand(`code-for-ibmi.showAdditionalSettings`, undefined, `Debugger`);
          }

        } else {
          const openTut = await vscode.window.showInformationMessage(`Looks like you have the debug PTF installed. Do you want to see the Walkthrough to set it up?`, `Take me there`);
          if (openTut === `Take me there`) {
            vscode.commands.executeCommand(`workbench.action.openWalkthrough`, `halcyontechltd.vscode-ibmi-walkthroughs#code-ibmi-debug`);
          }
        }
      }
    }
  });
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
  const enableDebugTracing = config?.debugEnableDebugTracing;

  const secure = config?.debugIsSecure;

  if (secure) {
    process.env[`DEBUG_CA_PATH`] = certificates.getLocalCertPath(connection!);
  }

  const pathKey = options.library.trim() + `/` + options.object.trim();

  const previousCommands = storage!.getDebugCommands();

  let currentCommand: string | undefined = previousCommands[pathKey] || `CALL PGM(` + pathKey + `)`;

  currentCommand = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    title: `Debug command`,
    prompt: `Command used to start debugging the ${pathKey} program object. The command is wrapped around SBMJOB.`,
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
      "startBatchJobCommand": `SBMJOB CMD(${currentCommand}) INLLIBL(${config?.libraryList.join(` `)}) CURLIB(${config?.currentLibrary}) JOBQ(QSYSNOMAX)`,
      "updateProductionFiles": updateProductionFiles,
      "trace": enableDebugTracing,
    };

    const debugResult = await vscode.debug.startDebugging(undefined, debugConfig, undefined);

    if (debugResult) {
      connectionConfirmed = true;
    } else {
      if (!connectionConfirmed) {
        temporaryPassword = undefined;
      }
    }
  }
}