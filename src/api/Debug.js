<<<<<<<< HEAD:src/api/Debug.js
const vscode = require(`vscode`);
const path = require(`path`);
========
import { ExtensionContext, Uri } from "vscode";
import Instance from "../Instance";

import * as vscode from 'vscode';
import path from "path";
>>>>>>>> 3570d93 (Initial setup):src/api/debug/index.ts

import * as certificates from "./certificates";

/**
 * @param {*} instance 
 * @param {vscode.ExtensionContext} context 
 */
exports.initialise = (instance, context) => {
  const startDebugging = (options) => {
    exports.startDebug(instance, options);
  }

  /** @param {vscode.Uri} uri */
  const getObjectFromUri = (uri) => {
    /** @type {IBMi} */
    const connection = instance.getConnection();
  
    /** @type {Configuration} */
    const configuration = instance.getConfig();
    
    const qualifiedPath = {
      library: undefined,
      object: undefined
    };

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

    return qualifiedPath;
  }

  const getPassword = async () => {
    /** @type {IBMi} */
    const connection = instance.getConnection();

    let password = await context.secrets.get(`${connection.currentConnectionName}_password`);
    if (!password) {
      password = await vscode.window.showInputBox({
        password: true,
        prompt: `Password for user profile ${connection.currentUser} is required to debug.`
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

        if (password) {
          startDebugging({
            ...qualifiedObject,
            password
          });
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

/**
 * @param {*} instance 
 * @param {{password: string, library: string, object: string}} options
 */
exports.startDebug = async (instance, options) => {
  /** @type {IBMi} */
  const connection = instance.getConnection();
  const port = `8005`; //TODO: make configurable
  const updateProductionFiles = false;
  const enableDebugTracing = true;

  const config = {
    "type": `IBMiDebug`,
    "request": `launch`,
    "name": `Remote debug: Launch a batch debug session`,
    "user": connection.currentUser.toUpperCase(),
    "password": options.password,
    "host": connection.currentHost,
    "port": port,
    "secure": true,  // Enforce secure mode
    "ignoreCertificateErrors": false,
    "library": options.library.toUpperCase(),
    "program": options.object.toUpperCase(),
    "startBatchJobCommand": `SBMJOB CMD(CALL PGM(` + options.library + `/` + options.object + `))`,
    "updateProductionFiles": updateProductionFiles,
    "trace": enableDebugTracing,
  };

  vscode.debug.startDebugging(undefined, config, undefined);
}