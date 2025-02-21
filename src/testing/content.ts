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
        const content = instance.getContent();

        const tmpFile = await util.promisify(tmp.file)();
        const memberContent = await content?.downloadMemberContent('QSYSINC', 'H', 'MATH', tmpFile);
        const tmpFileContent = (await workspace.fs.readFile(Uri.file(tmpFile))).toString();

        assert.strictEqual(tmpFileContent, memberContent);
      }
    },

    {
      name: `Write tab to member using SQL`, test: async () => {
        // Note: This is a known failure.
        const lines = [
          `if (a) {`,
          `\tcoolstuff();\t`,
          `}`
        ].join(`\n`);

        const connection = instance.getConnection();
        const config = instance.getConfig()!;

        assert.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);

        const tempLib = config!.tempLibrary;

        await connection!.runCommand({ command: `CRTSRCPF FILE(${tempLib}/TABTEST) RCDLEN(112)`, noLibList: true });
        await connection!.runCommand({ command: `ADDPFM FILE(${tempLib}/TABTEST) MBR(THEBADONE) SRCTYPE(HELLO)` });

        const theBadOneUri = getMemberUri({ library: tempLib, file: `TABTEST`, name: `THEBADONE`, extension: `HELLO` });

        // We have to read it first to create the alias!
        await workspace.fs.readFile(theBadOneUri);

        await workspace.fs.writeFile(theBadOneUri, Buffer.from(lines, `utf8`));

        const memberContentBuf = await workspace.fs.readFile(theBadOneUri);
        const fileContent = new TextDecoder().decode(memberContentBuf)

        assert.strictEqual(fileContent, lines);

      }
    },
  ]
};
