import assert from "assert";
import tmp from 'tmp';
import util, { TextDecoder } from 'util';
import { Uri, workspace } from "vscode";
import { TestSuite } from ".";
import { getMemberUri } from "../filesystems/qsys/QSysFs";
import { instance } from "../instantiate";

export const ContentSuite: TestSuite = {
  name: `Content FileSystem API tests`,
  tests: [
    {
      name: `Test downloadMemberContent`, test: async () => {
        const content = instance.getConnection()?.getContent();

        const tmpFile = await util.promisify(tmp.file)();
        const memberContent = await content?.downloadMemberContent('QSYSINC', 'H', 'MATH', tmpFile);
        const tmpFileContent = (await workspace.fs.readFile(Uri.file(tmpFile))).toString();

        assert.strictEqual(tmpFileContent, memberContent);
      }
    },

    {
      name: `Test downloadMemberContentWithDates SRCDTA`, test: async () => {
        // Note: This is a known failure.
        const lines = [
          `+123 C* Unaffected`,
          `     C* Next line must be unaffected`,
          `+123`,
          `** DATA`,
          `0123`,
          `+123`,
          `-123`
        ].join(`\n`);
        const connection = instance.getConnection()!;
        const config = connection.getConfig();

        assert.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);

        const testLib = config!.tempLibrary;
        const testFile = `SRCDTATEST`;
        const testMember = `MEMBER`;
        const testExt = `RPGLE`;

        await connection!.runCommand({ command: `DLTF FILE(${testLib}/${testFile})`, noLibList: true });
        await connection!.runCommand({ command: `CRTSRCPF FILE(${testLib}/${testFile}) RCDLEN(112)`, noLibList: true });
        await connection!.runCommand({ command: `ADDPFM FILE(${testLib}/${testFile}) MBR(${testMember}) SRCTYPE(${testExt})` });

        const testMemberRui = getMemberUri({ library: testLib, file: testFile, name: testMember, extension: testExt });

        await workspace.fs.writeFile(testMemberRui, Buffer.from(lines, `utf8`));

        const memberContentBuf = await workspace.fs.readFile(testMemberRui);
        await connection!.runCommand({ command: `DLTF FILE(${testLib}/${testFile})`, noLibList: true }); // Cleanup...!

        const fileContent = new TextDecoder().decode(memberContentBuf)

        assert.strictEqual(fileContent, lines);
      }
    },

    {
      name: `Write tab to member using SQL`, test: async () => {
        // Note: This is a known failure.
        let lines = [
          `if (a) {`,
          `\tcoolstuff();\t`,
          `}`
        ].join(`\n`);

        const connection = instance.getConnection()!;
        const config = connection.getConfig();

        assert.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);

        const tempLib = config!.tempLibrary;

        await connection!.runCommand({ command: `CRTSRCPF FILE(${tempLib}/TABTEST) RCDLEN(112)`, noLibList: true });
        await connection!.runCommand({ command: `ADDPFM FILE(${tempLib}/TABTEST) MBR(THEBADONE) SRCTYPE(HELLO)` });

        const theBadOneUri = getMemberUri({ library: tempLib, file: `TABTEST`, name: `THEBADONE`, extension: `HELLO` });

        // We have to read it first to create the alias!
        await workspace.fs.readFile(theBadOneUri);

        await workspace.fs.writeFile(theBadOneUri, Buffer.from(lines, `utf8`));

        const memberContentBuf = await workspace.fs.readFile(theBadOneUri);
        await connection!.runCommand({ command: `DLTF FILE(${tempLib}/TABTEST)`, noLibList: true }); // Cleanup...!

        const fileContent = new TextDecoder().decode(memberContentBuf)

        // Match how the SQL returns the lines
        lines = lines.split(`\n`).map(l => l.trimEnd()).join(`\n`);

        assert.strictEqual(fileContent, lines);

      }
    },
  ]
};
