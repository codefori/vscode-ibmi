import * as xml2js from "xml2js";

import { window } from "vscode";
import { instance } from "../../instantiate";

import * as gencmdxml from "./gencmdxml";

export async function init() {
  const connection = instance.getConnection()!;
  const clComponentsInstalled = checkRequirements();

  if (!clComponentsInstalled) {
    //We need to install the CL components
    window.showInformationMessage(`Would you like to install the CL prompting tools onto your system?`, `Yes`, `No`)
      .then(async result => {
        switch (result) {
        case `Yes`:
          try {
            await install();
            window.showInformationMessage(`CL components installed.`);
            connection.remoteFeatures[`GENCMDXML.PGM`] = `INSTALLED`;
          } catch (e) {
            window.showInformationMessage(`Failed to install CL components.`);
          }
          break;
        }
      });
  }
}

export function checkRequirements() {
  const connection = instance.getConnection();

  return (connection !== undefined && connection.remoteFeatures[`GENCMDXML.PGM`] !== undefined);
}

async function install() {
  const connection = instance.getConnection()!;
  const content = instance.getContent()!;
  const config = instance.getConfig()!;

  const tempLib = config.tempLibrary;

  try {
    await connection.remoteCommand(`CRTSRCPF ${tempLib}/QTOOLS`, undefined)
  } catch (e) {
    //It may exist already so we just ignore the error
  }

  await content.uploadMemberContent(undefined, tempLib, `QTOOLS`, `GENCMDXML`, gencmdxml.content.join(`\n`));
  await connection.remoteCommand(
    `CRTBNDCL PGM(${tempLib}/GENCMDXML) SRCFILE(${tempLib}/QTOOLS) DBGVIEW(*SOURCE) TEXT('vscode-ibmi xml generator for commands')`
  );
}

export async function getDefinition(command: string, library = `*LIBL`) {
  if (checkRequirements()) { 
    const validLibrary = library || `*LIBL`;
    
    /** @type {IBMi} */
    const connection = instance.getConnection();

    const content = instance.getContent();

    /** @type {Configuration} */
    const config = instance.getConfig();

    const tempLib = config!.tempLibrary;

    const targetCommand = command.padEnd(10) + validLibrary.padEnd(10);
    const targetName = command.toUpperCase().padEnd(10);

    const result = await connection?.runCommand({
      command: `CALL PGM(${tempLib}/GENCMDXML) PARM('${targetName}' '${targetCommand}')`,
      environment: `ile`
    });

    if (result?.code === 0) {
      const xml = await content!.downloadStreamfile(`/tmp/${targetName}`);

      const commandData = await xml2js.parseStringPromise(xml);

      return commandData;
    } else {
      return;
    }
  }
}