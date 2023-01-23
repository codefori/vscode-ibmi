import { ExtensionContext, Uri } from "vscode";
import Instance from "../Instance";

import * as vscode from 'vscode';
import path from "path";

import * as certificates from "./certificates";

/**
 * @param {*} instance 
 * @param {vscode.ExtensionContext} context 
 */
export function initialise(instance: Instance, context: ExtensionContext) {
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
      library: string|undefined,
      object: string|undefined
    } = {library: undefined, object: undefined};

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
  
  context.subscriptions.push(
    vscode.commands.registerCommand(`code-for-ibmi.debug.activeEditor`, async () => {
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
    }),
    vscode.commands.registerCommand(`code-for-ibmi.debug.runSetup`, async () => {
      const connection = instance.connection;
      if (connection) {
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
          vscode.commands.executeCommand(`setContext`, `code-for-ibmi:debug.remote`, true);
            
          const localExists = await certificates.checkLocalExists();
          let localCertsOk = true;

          if (localExists === true && remoteCertsAreNew === false) {
            localCertsOk = true;
          } else {
            try {
              await certificates.downloadToLocal(connection);
              localCertsOk = true;
            } catch (e: any) {
              vscode.window.showErrorMessage(`Failed to download debug certificate`);
            }
          }

          if (localCertsOk) {
            vscode.commands.executeCommand(`setContext`, `code-for-ibmi:debug.local`, true);
          }
        }

      } else {
        vscode.window.showErrorMessage(`No connection to IBM i available.`);
      }
    })
  )
}

interface DebugOptions {
  password: string;
  library: string;
  object: string;
};

export async function startDebug(instance: Instance, options: DebugOptions) {
  /** @type {IBMi} */
  const connection = instance.getConnection();
  const port = `8005`; //TODO: make configurable
  const updateProductionFiles = false; // TODO: configurable
  const enableDebugTracing = false; // TODO: configurable

  const secure = false; // TODO: make configurable

  if (secure) {
    // TODO: automatically download .p12, decode and place into local filesystem
    process.env[`DEBUG_CA_PATH`] = `/Users/barry/Downloads/merlin-https-cert.ca.crt`
  }

  const config = {
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
    "startBatchJobCommand": `SBMJOB CMD(CALL PGM(` + options.library + `/` + options.object + `))`,
    "updateProductionFiles": updateProductionFiles,
    "trace": enableDebugTracing,
  };

  vscode.debug.startDebugging(undefined, config, undefined);
}