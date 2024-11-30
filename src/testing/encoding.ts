import assert from "assert";
import os from "os";
import { Uri, workspace } from "vscode";
import { TestSuite } from ".";
import IBMi from "../api/IBMi";
import { Tools } from "../api/Tools";
import { getMemberUri } from "../filesystems/qsys/QSysFs";
import { instance } from "../instantiate";
import { IBMiObject } from "../typings";
import path from "path";

const contents = {
  '37': [`Hello world`],
  '273': [`Hello world`, `àáãÄÜö£øß`],
  '277': [`Hello world`, `çñßØ¢åæ`],
  '297': [`Hello world`, `âÑéè¥ýÝÞã`],
  '290': [`ｦｯ!ﾓﾄｴﾜﾈﾁｾ`, `Hello world`, `ｦｯ!ﾓﾄｴﾜﾈﾁｾ`],
  // '420': [`Hello world`, `ص ث ب ﻷ`],
  '420': [`Hello world`, `ص ث ب`],
}

const SHELL_CHARS = [`$`, `#`];

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
          const resultA = await connection?.runSQL(sqlA, { fakeBindings: [data], forceSafe: true });
          assert.ok(resultA?.length);

          const sqlB = `select '${data}' as THEDATA from sysibm.sysdummy1`;
          const resultB = await connection?.runSQL(sqlB, { forceSafe: true });
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
        const result = await connection?.runSQL(sql, { fakeBindings: [`QSYS2`, `SYSCOLUMNS`] });
        assert.ok(result?.length);
      }
    },
    {
      name: `Files and directories with spaces`, test: async () => {
        const connection = instance.getConnection()!;

        await connection.withTempDirectory(async tempDir => {
          const dirName = `hello world`;
          const dirWithSpace = path.posix.join(tempDir, dirName);
          const fileName = `hello world.txt`;
          const nameWithSpace = path.posix.join(dirWithSpace, fileName);

          await connection.sendCommand({command: `mkdir -p "${dirWithSpace}"`});
          await connection.content.createStreamFile(nameWithSpace);

          // Resolve and get attributes
          const resolved = await connection.content.streamfileResolve([fileName], [tempDir, dirWithSpace]);
          assert.strictEqual(resolved, nameWithSpace);

          const attributes = await connection.content.getAttributes(resolved, `CCSID`);
          assert.ok(attributes);

          // Write and read the files
          const uri = Uri.from({scheme: `streamfile`, path: nameWithSpace});
          await workspace.fs.writeFile(uri, Buffer.from(`Hello world`, `utf8`));

          const streamfileContents = await workspace.fs.readFile(uri);
          assert.ok(streamfileContents.toString().includes(`Hello world`));

          // List files
          const files = await connection.content.getFileList(tempDir);
          assert.strictEqual(files.length, 1);
          assert.ok(files.some(f => f.name === dirName && f.path === dirWithSpace));

          const files2 = await connection.content.getFileList(dirWithSpace);
          assert.strictEqual(files2.length, 1);
          assert.ok(files2.some(f => f.name === fileName && f.path === nameWithSpace));
        });
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

        const setResult = await connection?.sendQsh({ command: setCommand });

        const qshEscapeResult = await connection?.sendQsh({ command: printEscapeChar });
        const paseEscapeResult = await connection?.sendCommand({ command: printEscapeChar });

        console.log(qshEscapeResult?.stdout);
        console.log(paseEscapeResult?.stdout);

        const qshTextResultA = await connection?.sendQsh({ command: basicCommandA });
        const paseTextResultA = await connection?.sendCommand({ command: basicCommandA });

        const qshTextResultB = await connection?.sendQsh({ command: basicCommandB });
        const paseTextResultB = await connection?.sendCommand({ command: basicCommandB });

        const qshTextResultC = await connection?.sendQsh({ command: basicCommandC });
        const paseTextResultC = await connection?.sendCommand({ command: basicCommandC });

        assert.strictEqual(paseEscapeResult?.stdout, `\\`);
        assert.strictEqual(qshTextResultA?.stdout, text);
        assert.strictEqual(paseTextResultA?.stdout, text);
        assert.strictEqual(qshTextResultB?.stdout, text);
        assert.strictEqual(paseTextResultB?.stdout, text);
      }
    },
    {
      name: `streamfileResolve with dollar`, test: async () => {
        const connection = instance.getConnection()!;

        await connection.withTempDirectory(async tempDir => {
          const tempFile = path.posix.join(tempDir, `$hello`);
          await connection.content.createStreamFile(tempFile);

          const resolved = await connection.content.streamfileResolve([tempFile], [`/`]);

          assert.strictEqual(resolved, tempFile);
        });
      }
    },
    ...SHELL_CHARS.map(char => ({
      name: `Test streamfiles with shell character ${char}`, test: async () => {
        const connection = instance.getConnection()!;

        const nameCombos = [`${char}ABC`, `ABC${char}`, `${char}ABC${char}`, `A${char}C`];

        await connection.withTempDirectory(async tempDir => {
          for (const name of nameCombos) {
            const tempFile = path.posix.join(tempDir, `${name}.txt`);
            await connection.content.createStreamFile(tempFile);
            
            const resolved = await connection.content.streamfileResolve([tempFile], [`/`]);
            assert.strictEqual(resolved, tempFile);

            const attributes = await connection.content.getAttributes(resolved, `CCSID`);
            assert.ok(attributes);

            const uri = Uri.from({scheme: `streamfile`, path: tempFile});

            await workspace.fs.writeFile(uri, Buffer.from(`Hello world`, `utf8`));
            
            const streamfileContents = await workspace.fs.readFile(uri);
            assert.strictEqual(streamfileContents.toString(), `Hello world`);
          }
        });
      }
    })),
    ...SHELL_CHARS.map(char => ({
      name: `Test members with shell character ${char}`, test: async () => {
        const content = instance.getContent();
        const config = instance.getConfig();
        const connection = instance.getConnection()!;

        if (!connection.variantChars.local.includes(char)) {
          // This test will fail if $ is not a variant character, 
          // since we're testing object names here
          return;
        }

        const tempLib = config!.tempLibrary,
          tempSPF = `TESTINGS`,
          tempMbr = char + Tools.makeid(4)

        await connection!.runCommand({
          command: `CRTSRCPF ${tempLib}/${tempSPF} MBR(*NONE)`,
          environment: `ile`
        });

        await connection!.runCommand({
          command: `ADDPFM FILE(${tempLib}/${tempSPF}) MBR(${tempMbr}) `,
          environment: `ile`
        });

        const baseContent = `Hello world\r\n`;

        const attributes = await content?.getAttributes({ library: tempLib, name: tempSPF, member: tempMbr }, `CCSID`);
        assert.ok(attributes);

        const uploadResult = await content?.uploadMemberContent(undefined, tempLib, tempSPF, tempMbr, baseContent);
        assert.ok(uploadResult);

        const memberContentA = await content?.downloadMemberContent(undefined, tempLib, tempSPF, tempMbr);
        assert.strictEqual(memberContentA, baseContent);

        const memberUri = getMemberUri({ library: tempLib, file: tempSPF, name: tempMbr, extension: `TXT` });

        const memberContentB = await workspace.fs.readFile(memberUri);
        let contentStr = new TextDecoder().decode(memberContentB);
        assert.ok(contentStr.includes(`Hello world`));

        await workspace.fs.writeFile(memberUri, Buffer.from(`Woah`, `utf8`));

        const memberContentBuf = await workspace.fs.readFile(memberUri);
        let fileContent = new TextDecoder().decode(memberContentBuf);

        assert.ok(fileContent.includes(`Woah`));
      }
    })),
    {
      name: "Listing objects with variants",
      test: async () => {
        const connection = instance.getConnection();
        const content = instance.getConnection()?.content;
        if (connection && content) {
          const tempLib = connection.config?.tempLibrary!;
          const ccsid = connection.getCcsid();

          let library = `TESTLIB${connection.variantChars.local}`;
          let skipLibrary = false;
          const sourceFile = `${connection.variantChars.local}TESTFIL`;
          const dataArea = `TSTDTA${connection.variantChars.local}`;
          const members: string[] = [];

          for (let i = 0; i < 5; i++) {
            members.push(`TSTMBR${connection.variantChars.local}${i}`);
          }

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
            commands.push(`ADDPFM FILE(${library}/${sourceFile}) MBR(${member}) SRCTYPE(TXT) TEXT('Test ${member}')`);
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

            const libl = await content.getLibraryList([library]);
            assert.strictEqual(libl.length, 1);
            assert.strictEqual(libl[0].name, library);
          }

          const checkFile = (expectedObject: IBMiObject) => {
            assert.ok(expectedObject);
            assert.ok(expectedObject.sourceFile, `${expectedObject.name} not a source file`);
            assert.strictEqual(expectedObject.name, sourceFile);
            assert.strictEqual(expectedObject.library, library);
          };

          const nameFilter = await content.getObjectList({ library, types: ["*ALL"], object: `${connection.variantChars.local[0]}*` });
          assert.strictEqual(nameFilter.length, 1);
          assert.ok(nameFilter.some(obj => obj.library === library && obj.type === `*FILE` && obj.name === sourceFile));

          const objectList = await content.getObjectList({ library, types: ["*ALL"] });
          assert.ok(objectList.some(obj => obj.library === library && obj.type === `*FILE` && obj.name === sourceFile && obj.sourceFile === true));
          assert.ok(objectList.some(obj => obj.library === library && obj.type === `*DTAARA` && obj.name === dataArea));

          const expectedMembers = await content.getMemberList({ library, sourceFile });
          assert.ok(expectedMembers);
          assert.ok(expectedMembers.every(member => members.find(m => m === member.name && member.text?.includes(m))));

          const sourceFilter = await content.getObjectList({ library, types: ["*SRCPF"], object: `${connection.variantChars.local[0]}*` });
          assert.strictEqual(sourceFilter.length, 1);
          assert.ok(sourceFilter.some(obj => obj.library === library && obj.type === `*FILE` && obj.name === sourceFile));

          const [expectDataArea] = await content.getObjectList({ library, object: dataArea, types: ["*DTAARA"] });
          assert.strictEqual(expectDataArea.name, dataArea);
          assert.strictEqual(expectDataArea.library, library);
          assert.strictEqual(expectDataArea.type, `*DTAARA`);

          const [expectedSourceFile] = await content.getObjectList({ library, object: sourceFile, types: ["*SRCPF"] });
          checkFile(expectedSourceFile);

        }
      }
    },
    {
      name: `Library list supports dollar sign variant`, test: async () => {
        const connection = instance.getConnection()!;
        const library = `TEST${connection.variantChars.local}LIB`;
        const sourceFile = `TEST${connection.variantChars.local}FIL`;
        const member =  `TEST${connection.variantChars.local}MBR`;
        const ccsid = connection.getCcsid();

        if (library.includes(`$`)) {
          await connection.runCommand({ command: `DLTLIB LIB(${library})`, noLibList: true });

          const crtLib = await connection.runCommand({ command: `CRTLIB LIB(${library}) TYPE(*PROD)`, noLibList: true });
          if (Tools.parseMessages(crtLib.stderr).findId("CPD0032")) {
            return;
          }

          const createSourceFileCommand = await connection.runCommand({ command: `CRTSRCPF FILE(${library}/${sourceFile}) RCDLEN(112) CCSID(${ccsid})`, noLibList: true });
          assert.strictEqual(createSourceFileCommand.code, 0);

          const addPf = await connection.runCommand({ command: `ADDPFM FILE(${library}/${sourceFile}) MBR(${member}) SRCTYPE(TXT)`, noLibList: true });
          assert.strictEqual(addPf.code, 0);

          await connection.content.uploadMemberContent(undefined, library, sourceFile, member, [`**free`, `dsply 'Hello world';`, `return;`].join(`\n`));

          // Ensure program compiles with dollar sign in current library
          const compileResultA = await connection.runCommand({ command: `CRTBNDRPG PGM(${library}/${member}) SRCFILE(${library}/${sourceFile}) SRCMBR(${member})`, env: {'&CURLIB': library} });
          assert.strictEqual(compileResultA.code, 0);

          // Ensure program compiles with dollar sign in current library
          const compileResultB = await connection.runCommand({ command: `CRTBNDRPG PGM(${library}/${member}) SRCFILE(${library}/${sourceFile}) SRCMBR(${member})`, env: {'&LIBL': library} });
          assert.strictEqual(compileResultB.code, 0);
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
        const variantMember = `${connection.variantChars.local}MBR`;

        const attemptDelete = await connection.runCommand({ command: `DLTF FILE(${tempLib}/${testFile})`, noLibList: true });

        const createResult = await runCommandsWithCCSID(connection, [`CRTSRCPF FILE(${tempLib}/${testFile}) RCDLEN(112) CCSID(${ccsidData.userDefaultCCSID})`], ccsidData.userDefaultCCSID);
        assert.strictEqual(createResult.code, 0);

        const addPf = await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/${testFile}) MBR(${testMember}) SRCTYPE(TXT)`, noLibList: true });
        assert.strictEqual(addPf.code, 0);

        const attributes = await connection.content.getAttributes({ library: tempLib, name: testFile, member: testMember }, `CCSID`);
        assert.ok(attributes);
        assert.strictEqual(attributes[`CCSID`], String(ccsidData.userDefaultCCSID));

        /// Test for getAttributes on member with all variants

        const addPfB = await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/${testFile}) MBR(${variantMember}) SRCTYPE(TXT)`, noLibList: true });
        assert.strictEqual(addPfB.code, 0);

        const attributesB = await connection.content.getAttributes({ library: tempLib, name: testFile, member: variantMember }, `CCSID`);
        assert.ok(attributesB);
        assert.strictEqual(attributesB[`CCSID`], String(ccsidData.userDefaultCCSID));

        /// -----

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
        assert.strictEqual(files[0].name, connection.sysNameInAmerican(testMember) + `.MBR`);

        await connection.content.uploadMemberContent(undefined, tempLib, testFile, testMember, [`**free`, `dsply 'Hello world';`, `   `, `   `, `return;`].join(`\n`));

        const compileResult = await connection.runCommand({ command: `CRTBNDRPG PGM(${tempLib}/${testMember}) SRCFILE(${tempLib}/${testFile}) SRCMBR(${testMember})`, noLibList: true });
        assert.strictEqual(compileResult.code, 0);

        const memberUri = getMemberUri({ library: tempLib, file: testFile, name: testMember, extension: `RPGLE` });

        const content = await workspace.fs.readFile(memberUri);
        let contentStr = new TextDecoder().decode(content);
        assert.ok(!contentStr.includes(`0`));
        assert.ok(contentStr.includes(`dsply 'Hello world';`));

        await workspace.fs.writeFile(memberUri, Buffer.from([`**free`, `dsply 'Woah';`, `   `, `   `, `return;`].join(`\n`), `utf8`));

        const memberContentBuf = await workspace.fs.readFile(memberUri);
        let fileContent = new TextDecoder().decode(memberContentBuf);

        assert.ok(fileContent.includes(`Woah`));
        assert.ok(!fileContent.includes(`0`));
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

        // Initial read to create the alias
        await workspace.fs.readFile(theBadOneUri);

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
