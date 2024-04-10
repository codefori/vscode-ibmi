import assert from "assert";
import tmp from 'tmp';
import util, { TextDecoder } from 'util';
import { Uri, workspace } from "vscode";
import { TestSuite } from ".";
import { Tools } from "../api/Tools";
import { instance } from "../instantiate";
import { CommandResult } from "../typings";
import { getMemberUri } from "../filesystems/qsys/QSysFs";

export const EncodingSuite: TestSuite = {
  name: `Encoding tests`,
  before: async () => {
    const config = instance.getConfig()!;
    assert.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);
  },

  tests: [
    {
      name: `Encoding 37`, test: async () => {
        const connection = instance.getConnection();
        const config = instance.getConfig()!;

        const lines = [
          `Hello world`
        ].join(`\n`);

        const tempLib = config!.tempLibrary;

        const file = `TEST37`;

        await connection!.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${file}) RCDLEN(112) CCSID(37)`, noLibList: true });
        await connection!.runCommand({ command: `ADDPFM FILE(${tempLib}/${file}) MBR(THEMEMBER) SRCTYPE(TXT)`, noLibList: true });

        const theBadOneUri = getMemberUri({library: tempLib, file, name: `THEMEMBER`, extension: `TXT`});

        await workspace.fs.readFile(theBadOneUri);

        await workspace.fs.writeFile(theBadOneUri, Buffer.from(lines, `utf8`));

        const memberContentBuf = await workspace.fs.readFile(theBadOneUri);
        const fileContent = new TextDecoder().decode(memberContentBuf)
        
        assert.strictEqual(fileContent, lines);
      },
    },
    // {
    //   name: `Encoding 273`, test: async () => {
    //     const connection = instance.getConnection();
    //     const config = instance.getConfig()!;

    //     const lines = [
    //       `Hello world`,
    //       `àáãÄÜö£øß`
    //     ].join(`\n`);

    //     const tempLib = config!.tempLibrary;

    //     connection?.setOverrideCcsid(37);

    //     const file = `TEST273`;

    //     await connection!.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${file}) RCDLEN(112) CCSID(273)`, noLibList: true });
    //     await connection!.runCommand({ command: `ADDPFM FILE(${tempLib}/${file}) MBR(THEMEMBER) SRCTYPE(TXT)`, noLibList: true });

    //     const theBadOneUri = getMemberUri({library: tempLib, file, name: `THEMEMBER`, extension: `TXT`});

    //     await workspace.fs.readFile(theBadOneUri);

    //     await workspace.fs.writeFile(theBadOneUri, Buffer.from(lines, `utf8`));

    //     const memberContentBuf = await workspace.fs.readFile(theBadOneUri);
    //     const fileContent = new TextDecoder().decode(memberContentBuf)
        
    //     assert.strictEqual(fileContent, lines);
    //   }
    // }
  ]
};
