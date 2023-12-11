import { ExtensionContext, Uri } from "vscode";
import Instance from "../Instance";

import * as vscode from 'vscode';
import path from "path";

import * as certificates from "./certificates";
import * as server from "./server";
import { copyFileSync } from "fs";
import { instance } from "../../instantiate";
import { getEnvConfig } from "../local/env";
import { ILELibrarySettings } from "../CompileTools";

const debugExtensionId = `IBM.ibmidebug`;

// These context values are used for walkthroughs only
const ptfContext = `code-for-ibmi:debug.ptf`;
const remoteCertContext = `code-for-ibmi:debug.remote`;
const localCertContext = `code-for-ibmi:debug.local`;

let connectionConfirmed = false;
let temporaryPassword: string | undefined;

export function isManaged() {
  return process.env[`DEBUG_MANAGED`] === `true`;
}

export async function initialize(context: ExtensionContext) {
  const debugExtensionAvailable = () => {
    const debugclient = vscode.extensions.getExtension(debugExtensionId);
    return debugclient !== undefined;
  }

  const startDebugging = async (objectLibrary: string, objectName: string, workspaceFolder?: vscode.WorkspaceFolder) => {
    if (debugExtensionAvailable()) {
      const connection = instance.getConnection();
      const config = instance.getConfig();
      if (connection && config) {
        if (connection.remoteFeatures[`startDebugService.sh`]) {
          const password = await getPassword();

          const libraries: ILELibrarySettings = {
            currentLibrary: config?.currentLibrary,
            libraryList: config?.libraryList
          };

          // If we are debugging from a workspace, perhaps
          // the user has a custom CURLIB and LIBL setup.
          if (workspaceFolder) {
            const env = await getEnvConfig(workspaceFolder);
            if (env[`CURLIB`]) {
              objectLibrary = env[`CURLIB`];
              libraries.currentLibrary = env[`CURLIB`];
            }

            if (env[`LIBL`]) {
              libraries.libraryList = env[`LIBL`].split(` `);
            }
          }

          if (password) {
            const debugOpts: DebugOptions = {
              password,
              library: objectLibrary,
              object: objectName,
              libraries
            };

            startDebug(instance, debugOpts);
          }
        } else {
          if (isManaged()) {
            vscode.window.showInformationMessage(`Looks like the Debug Service is not setup on this IBM i server. Please contact your system administrator.`);

          } else {
            const openTut = await vscode.window.showInformationMessage(`Looks like you do not have the debug PTF installed. Do you want to see the Walkthrough to set it up?`, `Take me there`);
            if (openTut === `Take me there`) {
              vscode.commands.executeCommand(`workbench.action.openWalkthrough`, `halcyontechltd.vscode-ibmi-walkthroughs#code-ibmi-debug`);
            }
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
  }

  const getObjectFromUri = async (uri: Uri) => {
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
          const streamfilePath = path.parse(uri.path);
          qualifiedPath.library = configuration.currentLibrary;
          qualifiedPath.object = streamfilePath.name;
          break;
        case `file`:
          const localPath = path.parse(uri.path);
          qualifiedPath.library = configuration.currentLibrary;
          qualifiedPath.object = localPath.name;
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
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        // Get the workspace folder if one is available.
        const workspaceFolder = [`member`, `streamfile`].includes(activeEditor.document.uri.scheme) ? undefined : vscode.workspace.getWorkspaceFolder(activeEditor.document.uri);

        const qualifiedObject = await getObjectFromUri(activeEditor.document.uri);

        if (qualifiedObject.library && qualifiedObject.object) {
          startDebugging(qualifiedObject.library, qualifiedObject.object, workspaceFolder);
        }
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.debug.program`, async (node) => {
      const [library, object] = node.path.split(`/`);
      if (library && object) {
        startDebugging(library, object);
      }
    }),

    vscode.commands.registerCommand(`code-for-ibmi.debug.setup.remote`, async () => {
      const connection = instance.getConnection();
      if (connection) {
        const ptfInstalled = debugPTFInstalled();

        if (ptfInstalled) {
          const remoteCertExists = await certificates.remoteServerCertExists(connection);
          let remoteCertsAreNew = false;
          let remoteCertsOk = false;

          if (remoteCertExists) {
            vscode.window.showInformationMessage(`Certificates already exist on the server.`);
            remoteCertsOk = true;
          }

          // This popup will show a message based on if the certificates exist or not
          const doSetup = await vscode.window.showInformationMessage(`Debug setup`, {
            modal: true,
            detail: `${remoteCertExists
              ? `Debug certificates already exist on this system! This will download the client certificates to enable secure debugging.`
              : `Debug certificates are not setup on the system. This will generate the certificates and download them to your device.`
              } Continue with setup?`
          }, `Continue`);

          if (doSetup) {
            try {
              // If the remote certs don't exist, generate them
              if (!remoteCertExists) {
                await certificates.setup(connection);
                vscode.window.showInformationMessage(`Certificates successfully generated on server.`);
                remoteCertsOk = true;
                remoteCertsAreNew = true;
              }

              // Download the client certificates to the device if setup correctly.
              if (remoteCertsOk) {
                vscode.commands.executeCommand(`code-for-ibmi.debug.setup.local`);
              }
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

            try {
              const remoteClientCertExists = await certificates.remoteClientCertExists(connection);

              // If the client certificate exists on the server, download it
              if (remoteClientCertExists) {
                await certificates.downloadClientCert(connection);
                localCertsOk = true;
                vscode.window.showInformationMessage(`Debug certificate downloaded from the server.`);

              } else {
                const doImport = await vscode.window.showInformationMessage(`Debug setup`, {
                  modal: true,
                  detail: `The client certificate is not setup on the server. Would you like to import a certificate from your device?`
                }, `Yes`, `No`);

                if (doImport === `Yes`) {
                  const selectedFile = await vscode.window.showOpenDialog({
                    canSelectFiles: true,
                    canSelectFolders: false,
                    canSelectMany: false,
                    title: `Select debug client certificate`
                  });

                  if (selectedFile && selectedFile.length === 1) {
                    copyFileSync(selectedFile[0].fsPath, certificates.getLocalCertPath(connection));
                    localCertsOk = true;
                    vscode.window.showInformationMessage(`Certificate imported.`);
                  }
                }
              }
            } catch (e) {
              vscode.window.showErrorMessage(`Failed to work with debug client certificate. See Code for IBM i logs.`);
            }
          } else {
            vscode.window.showInformationMessage(`Import of debug client certificate skipped as not required in current mode.`, `Open configuration`).then(result => {
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
          const remoteExists = await certificates.remoteServerCertExists(connection);
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
          vscode.window.withProgress({ location: vscode.ProgressLocation.Notification }, async (progress) => {
            progress.report({ message: `Ending Debug Service` });
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
    if (connection && content && debugPTFInstalled()) {
      vscode.commands.executeCommand(`setContext`, ptfContext, true);

      if (!isManaged()) {
        const isSecure = connection.config!.debugIsSecure;

        if (validateIPv4address(connection.currentHost) && isSecure) {
          vscode.window.showWarningMessage(`You are using an IPv4 address to connect to this system. This may cause issues with secure debugging. Please use a hostname in the Login Settings instead.`);
        }

        const remoteCertsExist = await certificates.remoteServerCertExists(connection);

        if (remoteCertsExist) {
          vscode.commands.executeCommand(`setContext`, remoteCertContext, true);

          if (isSecure) {
            const localCertsExists = await certificates.localClientCertExists(connection);

            if (localCertsExists) {
              vscode.commands.executeCommand(`setContext`, localCertContext, true);
            } else {
              vscode.commands.executeCommand(`code-for-ibmi.debug.setup.local`);
            }
          }
        } else {
          const existingDebugService = await server.getRunningJob(connection.config?.debugPort || "8005", instance.getContent()!);
          
          const openTut = await vscode.window.showInformationMessage(`${
            existingDebugService ? 
            `Looks like the Debug Service was started by an external service. This may impact your VS Code experience.` : 
            `Looks like you have the debug PTF but don't have it configured.`
          } Do you want to see the Walkthrough to set it up?`, `Take me there`);

          if (openTut === `Take me there`) {
            vscode.commands.executeCommand(`workbench.action.openWalkthrough`, `halcyontechltd.vscode-ibmi-walkthroughs#code-ibmi-debug`);
          }
        }
      }
    }
  });

  vscode.commands.executeCommand(`setContext`, `code-for-ibmi:debugManaged`, isManaged());
}

function validateIPv4address(ipaddress: string) {  
  if (/^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(ipaddress)) {  
    return (true)  
  }
  return (false)  
}  

interface DebugOptions {
  password: string;
  library: string;
  object: string;
  libraries: ILELibrarySettings
};

export async function startDebug(instance: Instance, options: DebugOptions) {
  const connection = instance.getConnection();
  const config = instance.getConfig();
  const storage = instance.getStorage();

  const port = config?.debugPort;
  const updateProductionFiles = config?.debugUpdateProductionFiles;
  const enableDebugTracing = config?.debugEnableDebugTracing;

  let secure = true;

  if (isManaged()) {
    // If we're in a managed environment, only set secure if a cert is set
    secure = process.env[`DEBUG_CA_PATH`] ? true : false;
  } else {
    secure = config?.debugIsSecure || false;
    if (secure) {
      process.env[`DEBUG_CA_PATH`] = certificates.getLocalCertPath(connection!);
    } else {
      // Environment variable must be deleted otherwise cert issues will happen
      delete process.env[`DEBUG_CA_PATH`];
    }
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
      "startBatchJobCommand": `SBMJOB CMD(${currentCommand}) INLLIBL(${options.libraries.libraryList.join(` `)}) CURLIB(${options.libraries.currentLibrary}) JOBQ(QSYSNOMAX) MSGQ(*USRPRF)`,
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