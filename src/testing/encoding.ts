import assert from "assert";
import path from "path";
import { Uri, workspace } from "vscode";
import { TestSuite } from ".";
import IBMi from "../api/IBMi";
import { Tools } from "../api/Tools";
import { getMemberUri } from "../filesystems/qsys/QSysFs";
import { instance } from "../instantiate";

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

  await connection.content.uploadMemberContent(tempLib, testPgmSrcFile, testPgmName, commands.join(`\n`));

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

        const uploadResult = await content?.uploadMemberContent(tempLib, tempSPF, tempMbr, baseContent);
        assert.ok(uploadResult);

        const memberContentA = await content?.downloadMemberContent(tempLib, tempSPF, tempMbr);
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

        await connection.content.uploadMemberContent(tempLib, testFile, testMember, [`**free`, `dsply 'Hello world';`, `   `, `   `, `return;`].join(`\n`));

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
