import assert from "assert";
import tmp from 'tmp';
import util, { TextDecoder } from 'util';
import { Uri, workspace } from "vscode";
import { TestSuite } from ".";
import { Tools } from "../api/Tools";
import { instance } from "../instantiate";
import { CommandResult } from "../typings";
import { getMemberUri } from "../filesystems/qsys/QSysFs";
import path from "path";
import IBMi from "../api/IBMi";

const contents = {
  '37': [`Hello world`],
  '273': [`Hello world`, `àáãÄÜö£øß`],
  '277': [`Hello world`, `çñßØ¢åæ`],
  '297': [`Hello world`, `âÑéè¥ýÝÞã`],
  '290': [`ｦｯ!ﾓﾄｴﾜﾈﾁｾ`, `Hello world`, `ｦｯ!ﾓﾄｴﾜﾈﾁｾ`],
  // '420': [`Hello world`, `ص ث ب ﻷ`],
  '420': [`Hello world`, `ص ث ب`],
}

const rtlEncodings = [`420`];

async function runCommandsWithCCSID(connection: IBMi, commands: string[], ccsid: number) {
  const testPgmSrcFile = `TESTING`;
  const config = connection.config!;

  const tempLib = config.tempLibrary;
  const testPgmName = `T${commands.length}${ccsid}`;
  const sourceFileCreated = await connection!.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${testPgmSrcFile}) RCDLEN(112) CCSID(${ccsid})`, noLibList: true });

  await connection.content.uploadMemberContent(undefined, tempLib, testPgmSrcFile, testPgmName, commands.join(`\n`));

  const compileCommand = `CRTBNDCL PGM(${tempLib}/${testPgmName}) SRCFILE(${tempLib}/${testPgmSrcFile}) SRCMBR(${testPgmName}) REPLACE(*YES)`;
  const compileResult = await connection.runCommand({ command: compileCommand, noLibList: true });

  if (compileResult.code !== 0) {
    return compileResult;
  }

  const callCommand = `CALL ${tempLib}/${testPgmName}`;
  const result = await connection.runCommand({ command: callCommand, noLibList: true });

  return result;
}

export const EncodingSuite: TestSuite = {
  name: `Encoding tests`,
  before: async () => {
    const config = instance.getConfig()!;
    assert.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);
  },

  tests: [
    {
      name: `284: Ñ character in source file with QCCSID 65535`, test: async () => {
        // CHGUSRPRF LIAMA CCSID(284) CNTRYID(ES) LANGID(ESP)
        const connection = instance.getConnection()!;
        const config = instance.getConfig()!;

        const ccsidData = connection.getCcsids()!;

        if (ccsidData.qccsid === 65535 && ccsidData.userDefaultCCSID === 284) { //TODO: add a check for the CCSID of the user profile for this test
          const tempLib = config.tempLibrary;
          const testFile = `ÑSOURCES`;
          const testMember = `THEMEMBER`;

          // const attemptDelete = await connection.runCommand({ command: `DLTF FILE(${tempLib}/${connection.sysNameInAmerican(testFile)})`, noLibList: true });
          const attemptDelete = await connection.runCommand({ command: `DLTF FILE(${tempLib}/#SOURCES)`, noLibList: true });

          const clProgram = [
            `CRTSRCPF FILE(${tempLib}/${testFile}) RCDLEN(112) CCSID(284)`,
            `ADDPFM FILE(${tempLib}/${testFile}) MBR(${testMember}) SRCTYPE(TXT)`
          ];

          const result = await runCommandsWithCCSID(connection, clProgram, 284);

          assert.strictEqual(result.code, 0);

          const objects = await connection.content.getObjectList({ library: tempLib, types: [`*SRCPF`] });

          const members = await connection.content.getMemberList({ library: tempLib, sourceFile: testFile });

          // TODO: add validations

          // TODO: add

          assert.ok(objects.length);
          assert.ok(members.length);
        }
      },
    },

    ...Object.keys(contents).map(ccsid => ({
      name: `Encoding ${ccsid}`, test: async () => {
        const connection = instance.getConnection();
        const config = instance.getConfig()!;

        const oldLines = contents[ccsid as keyof typeof contents];
        const lines = oldLines.join(`\n`);

        const tempLib = config!.tempLibrary;

        const file = `TEST${ccsid}`;

        await connection!.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${file}) RCDLEN(112) CCSID(${ccsid})`, noLibList: true });
        await connection!.runCommand({ command: `ADDPFM FILE(${tempLib}/${file}) MBR(THEMEMBER) SRCTYPE(TXT)`, noLibList: true });

        const theBadOneUri = getMemberUri({ library: tempLib, file, name: `THEMEMBER`, extension: `TXT` });

        await workspace.fs.readFile(theBadOneUri);

        await workspace.fs.writeFile(theBadOneUri, Buffer.from(lines, `utf8`));

        const memberContentBuf = await workspace.fs.readFile(theBadOneUri);
        let fileContent = new TextDecoder().decode(memberContentBuf);

        if (rtlEncodings.includes(ccsid)) {
          const newLines = fileContent.split(`\n`);

          assert.strictEqual(newLines.length, 2);
          assert.ok(newLines[1].startsWith(` `)); // RTL

          assert.strictEqual(newLines[0].trim(), oldLines[0]);
          assert.strictEqual(newLines[1].trim(), oldLines[1]);
        } else {
          assert.deepStrictEqual(fileContent, lines);
        }
      }
    }))
  ]
};
