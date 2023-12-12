import { window } from "vscode";
import { instance } from "../../instantiate";

import * as gencmdxml from "./gencmdxml";

export async function init() {
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
            } catch (e) {
              window.showInformationMessage(`Failed to install CL components.`);
            }
            break;
        }
      });
  }
}

function checkRequirements() {
  const connection = instance.getConnection();

  return (connection !== undefined && connection.remoteFeatures[`GENCMDXML.PGM`] !== undefined);
}

async function install() {
  const connection = instance.getConnection()!;
  const content = instance.getContent()!;
  const config = instance.getConfig()!;

  const tempLib = config.tempLibrary;

  try {
    await connection.runCommand({ command: `CRTSRCPF ${tempLib}/QTOOLS`, noLibList: true })
  } catch (e) {
    //It may exist already so we just ignore the error
  }

  await content.uploadMemberContent(undefined, tempLib, `QTOOLS`, `GENCMDXML`, gencmdxml.content.join(`\n`));
  await connection.runCommand({
    command: `CRTBNDCL PGM(${tempLib}/GENCMDXML) SRCFILE(${tempLib}/QTOOLS) DBGVIEW(*SOURCE) TEXT('vscode-ibmi xml generator for commands')`,
    noLibList: true
  });
}