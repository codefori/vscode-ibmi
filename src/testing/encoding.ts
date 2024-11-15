import assert from "assert";
import os from "os";
import { workspace } from "vscode";
import { TestSuite } from ".";
import IBMi from "../api/IBMi";
import { Tools } from "../api/Tools";
import { getMemberUri } from "../filesystems/qsys/QSysFs";
import { instance } from "../instantiate";
import { IBMiObject } from "../typings";

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
    const config = instance.getConfig();
    if (config) {
      assert.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);
    }
  },

  tests: [
    {
      name: `Prove that input strings are messed up by CCSID`, test: async () => {
        const connection = instance.getConnection();
        let howManyTimesItMessedUpTheResult = 0;

        for (const strCcsid in contents) {
          const data = contents[strCcsid as keyof typeof contents].join(``);

          // Note that it always works with the buffer!
          const sqlA = `select ? as THEDATA from sysibm.sysdummy1`;
          const resultA = await connection?.runSQL(sqlA, [data]);
          assert.ok(resultA?.length);
          
          const sqlB = `select '${data}' as THEDATA from sysibm.sysdummy1`;
          const resultB = await connection?.runSQL(sqlB);
          assert.ok(resultB?.length);

          assert.strictEqual(resultA![0].THEDATA, data);
          if (resultB![0].THEDATA !== data) {
            howManyTimesItMessedUpTheResult++;
          }
        }

        assert.ok(howManyTimesItMessedUpTheResult);
      }
    },
    {
      name: `Compare Unicode to EBCDIC successfully`, test: async () => {
        const connection = instance.getConnection();

        const sql = `select table_name, table_owner from qsys2.systables where table_schema = ? and table_name = ?`;
        const result = await connection?.runSQL(sql, [`QSYS2`, `SYSCOLUMNS`]);
        assert.ok(result?.length);
      }
    },
    {
      name: `Run variants through shells`, test: async () => {
        const connection = instance.getConnection();

        const text = `Hello${connection?.variantChars.local}world`;
        const basicCommandA = `echo "${IBMi.escapeForShell(text)}"`;
        const basicCommandB = `echo '${text}'`;
        const basicCommandC = `echo 'abc'\\''123'`;
        const printEscapeChar = `echo "\\\\"`;
        const setCommand = `set`;

        const setResult = await connection?.sendQsh({command: setCommand});

        const qshEscapeResult = await connection?.sendQsh({command: printEscapeChar});
        const paseEscapeResult = await connection?.sendCommand({command: printEscapeChar});
        
        console.log(qshEscapeResult?.stdout);
        console.log(paseEscapeResult?.stdout);

        const qshTextResultA = await connection?.sendQsh({command: basicCommandA});
        const paseTextResultA = await connection?.sendCommand({command: basicCommandA});

        const qshTextResultB = await connection?.sendQsh({command: basicCommandB});
        const paseTextResultB = await connection?.sendCommand({command: basicCommandB});

        const qshTextResultC = await connection?.sendQsh({command: basicCommandC});
        const paseTextResultC = await connection?.sendCommand({command: basicCommandC});

        assert.strictEqual(paseEscapeResult?.stdout, `\\`);
        assert.strictEqual(qshTextResultA?.stdout, text);
        assert.strictEqual(paseTextResultA?.stdout, text);
        assert.strictEqual(qshTextResultB?.stdout, text);
        assert.strictEqual(paseTextResultB?.stdout, text);
      }
    },
    {
      name: `Test downloadMemberContent with dollar`, test: async () => {
        const content = instance.getContent();
        const config = instance.getConfig();
        const connection = instance.getConnection();
        const tempLib = config!.tempLibrary,
          tempSPF = `TESTINGS`,
          tempMbr = Tools.makeid(2) + `$` + Tools.makeid(2);

        await connection!.runCommand({
          command: `CRTSRCPF ${tempLib}/${tempSPF} MBR(*NONE)`,
          environment: `ile`
        });

        await connection!.runCommand({
          command: `ADDPFM FILE(${tempLib}/${tempSPF}) MBR(${tempMbr}) `,
          environment: `ile`
        });

        const baseContent = `Hello world\r\n`;

        const uploadResult = await content?.uploadMemberContent(undefined, tempLib, tempSPF, tempMbr, baseContent);
        assert.ok(uploadResult);

        const memberContent = await content?.downloadMemberContent(undefined, tempLib, tempSPF, tempMbr);
        assert.strictEqual(memberContent, baseContent);
      },
    },
    {
      name: "Listing objects with variants",
      test: async () => {
        const connection = instance.getConnection();
        const content = instance.getConnection()?.content;
        if (connection && content) {
          const tempLib = connection.config?.tempLibrary!;
          const ccsid = connection.getEncoding().ccsid;

          let library = `TESTLIB${connection.variantChars.local}`;
          let skipLibrary = false;
          const sourceFile = `TESTFIL${connection.variantChars.local}`;
          const dataArea = `TSTDTA${connection.variantChars.local}`;
          const members: string[] = [];

          for (let i = 0; i < 5; i++) {
            members.push(`TSTMBR${connection.variantChars.local}${i}`);
          }
          try {
            await connection.runCommand({ command: `DLTLIB LIB(${library})`, noLibList: true });

            const crtLib = await connection.runCommand({ command: `CRTLIB LIB(${library}) TYPE(*PROD)`, noLibList: true });
            if (Tools.parseMessages(crtLib.stderr).findId("CPD0032")) {
              //Not authorized: carry on, skip library name test
              library = tempLib;
              skipLibrary = true
            }

            let commands: string[] = [];

            commands.push(`CRTSRCPF FILE(${library}/${sourceFile}) RCDLEN(112) CCSID(${ccsid})`);
            for (const member of members) {
              commands.push(`ADDPFM FILE(${library}/${sourceFile}) MBR(${member}) SRCTYPE(TXT)`);
            }

            commands.push(`CRTDTAARA DTAARA(${library}/${dataArea}) TYPE(*CHAR) LEN(50) VALUE('hi')`);

            // runCommandsWithCCSID proves that using variant characters in runCommand works!
            const result = await runCommandsWithCCSID(connection, commands, ccsid);
            assert.strictEqual(result.code, 0);

            if (!skipLibrary) {
              const [expectedLibrary] = await content.getLibraries({ library });
              assert.ok(expectedLibrary);
              assert.strictEqual(library, expectedLibrary.name);

              const validated = await connection.content.validateLibraryList([tempLib, library]);
              assert.strictEqual(validated.length, 0);
            }

            const checkFile = (expectedObject: IBMiObject) => {
              assert.ok(expectedObject);
              assert.ok(expectedObject.sourceFile, `${expectedObject.name} not a source file`);
              assert.strictEqual(expectedObject.name, sourceFile);
              assert.strictEqual(expectedObject.library, library);
            };

            const objectList = await content.getObjectList({ library, types: ["*ALL"] });
            assert.ok(objectList.some(obj => obj.library === library && obj.type === `*FILE` && obj.name === sourceFile));
            assert.ok(objectList.some(obj => obj.library === library && obj.type === `*DTAARA` && obj.name === dataArea));

            const [expectDataArea] = await content.getObjectList({ library, object: dataArea, types: ["*DTAARA"] });
            assert.strictEqual(expectDataArea.name, dataArea);
            assert.strictEqual(expectDataArea.library, library);
            assert.strictEqual(expectDataArea.type, `*DTAARA`);

            const [expectedSourceFile] = await content.getObjectList({ library, object: sourceFile, types: ["*SRCPF"] });
            checkFile(expectedSourceFile);

            const expectedMembers = await content.getMemberList({ library, sourceFile });
            assert.ok(expectedMembers);
            assert.ok(expectedMembers.every(member => members.find(m => m === member.name)));
          }
          finally {
            // if (!skipLibrary && await content.checkObject({ library: "QSYS", name: library, type: "*LIB" })) {
            //   await connection.runCommand({ command: `DLTLIB LIB(${library})`, noLibList: true })
            // }
            // if (skipLibrary && await content.checkObject({ library, name: sourceFile, type: "*FILE" })) {
            //   await connection.runCommand({ command: `DLTF FILE(${library}/${sourceFile})`, noLibList: true })
            // }
          }
        }
      }
    },
    {
      name: `Variant character in source names and commands`, test: async () => {
        // CHGUSRPRF X CCSID(284) CNTRYID(ES) LANGID(ESP)
        const connection = instance.getConnection()!;
        const config = instance.getConfig()!;

        const ccsidData = connection.getCcsids()!;

        const tempLib = config.tempLibrary;
        const varChar = connection.variantChars.local[1];
        
        const testFile = `${varChar}SCOBBY`;
        const testMember = `${varChar}MEMBER`;

        const attemptDelete = await connection.runCommand({ command: `DLTF FILE(${tempLib}/${testFile})`, noLibList: true });

        const createResult = await runCommandsWithCCSID(connection, [`CRTSRCPF FILE(${tempLib}/${testFile}) RCDLEN(112) CCSID(${ccsidData.userDefaultCCSID})`], ccsidData.userDefaultCCSID);
        assert.strictEqual(createResult.code, 0);

        const addPf = await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/${testFile}) MBR(${testMember}) SRCTYPE(TXT)`, noLibList: true });
        assert.strictEqual(addPf.code, 0);

        const attributes = await connection.content.getAttributes({ library: tempLib, name: testFile, member: testMember }, `CCSID`);
        assert.ok(attributes);
        assert.strictEqual(attributes[`CCSID`], String(ccsidData.userDefaultCCSID));

        const objects = await connection.content.getObjectList({ library: tempLib, types: [`*SRCPF`] });
        assert.ok(objects.length);
        assert.ok(objects.some(obj => obj.name === testFile));

        const members = await connection.content.getMemberList({ library: tempLib, sourceFile: testFile });
        assert.ok(members.length);
        assert.ok(members.some(m => m.name === testMember));
        assert.ok(members.some(m => m.file === testFile));

        const smallFilter = await connection.content.getMemberList({ library: tempLib, sourceFile: testFile, members: `${varChar}*` });
        assert.ok(smallFilter.length);

        const files = await connection.content.getFileList(`/QSYS.LIB/${tempLib}.LIB/${connection.sysNameInAmerican(testFile)}.FILE`);
        assert.ok(files.length);

        await connection.content.uploadMemberContent(undefined, tempLib, testFile, testMember, [`**free`, `dsply 'Hello world';`, `return;`].join(`\n`));

        const compileResult = await connection.runCommand({ command: `CRTBNDRPG PGM(${tempLib}/${testMember}) SRCFILE(${tempLib}/${testFile}) SRCMBR(${testMember})`, noLibList: true });
        assert.strictEqual(compileResult.code, 0);

        const memberUri = getMemberUri({ library: tempLib, file: testFile, name: testMember, extension: `RPGLE` });

        const content = await workspace.fs.readFile(memberUri);
        let contentStr = new TextDecoder().decode(content);
        assert.ok(contentStr.includes(`dsply 'Hello world';`));

        await workspace.fs.writeFile(memberUri, Buffer.from(`Woah`, `utf8`));

        const memberContentBuf = await workspace.fs.readFile(memberUri);
        let fileContent = new TextDecoder().decode(memberContentBuf);

        assert.ok(fileContent.includes(`Woah`));
      },
    },

    ...Object.keys(contents).map(ccsid => ({
      name: `Encoding ${ccsid}`, test: async () => {
        const connection = instance.getConnection();
        const config = instance.getConfig()!;

        const oldLines = contents[ccsid as keyof typeof contents];
        const lines = oldLines.join(os.EOL);

        const tempLib = config!.tempLibrary;

        const file = `TEST${ccsid}`;

        await connection!.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${file}) RCDLEN(112) CCSID(${ccsid})`, noLibList: true });
        await connection!.runCommand({ command: `ADDPFM FILE(${tempLib}/${file}) MBR(THEMEMBER) SRCTYPE(TXT)`, noLibList: true });

        const theBadOneUri = getMemberUri({ library: tempLib, file, name: `THEMEMBER`, extension: `TXT` });
        await workspace.fs.writeFile(theBadOneUri, Buffer.from(lines, `utf8`));

        const memberContentBuf = await workspace.fs.readFile(theBadOneUri);
        const fileContent = new TextDecoder().decode(memberContentBuf).trimEnd();

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
