import assert from "assert";
import tmp from 'tmp';
import util, { TextDecoder } from 'util';
import { Uri, workspace } from "vscode";
import { TestSuite } from ".";
import { Tools } from "../api/Tools";
import { instance } from "../instantiate";
import { CommandResult } from "../typings";
import { getMemberUri } from "../filesystems/qsys/QSysFs";
import { GetNewLibl } from "../components/getNewLibl";
import { SqlToCsv } from "../components/sqlToCsv";

export const ComponentSuite: TestSuite = {
  name: `Component tests`,
  before: async () => {
    const config = instance.getConfig()!;
    assert.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);
  },

  tests: [
    {
      name: `Get new libl`, test: async () => {
        const connection = instance.getConnection()!
        const component = connection.getComponent<GetNewLibl>(`GetNewLibl`);

        if (component) {
          const newLibl = await component.getLibraryListFromCommand(`CHGLIBL CURLIB(SYSTOOLS)`);

          assert.strictEqual(newLibl?.currentLibrary, `SYSTOOLS`);

        } else {
          assert.fail(`Component not installed`);
        }
      },
    },
    {
      name: `SQL to CSV test`, test: async () => {
        const connection = instance.getConnection()!;
        const config = instance.getConfig()!;
        const component = connection.getComponent<SqlToCsv>(`SqlToCsv`);

        assert.ok(component);

        const lines = [
          `Hello world`,
          `àáãÄÜö£øß`
        ].join(`\n`);

        const tempLib = config.tempLibrary;

        const file = `TEST273`;

        await connection.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${file}) RCDLEN(112) CCSID(273)`, noLibList: true });
        await connection.runCommand({ command: `ADDPFM FILE(${tempLib}/${file}) MBR(THEMEMBER) SRCTYPE(TXT)`, noLibList: true });

        const theBadOneUri = getMemberUri({library: tempLib, file, name: `THEMEMBER`, extension: `TXT`});

        // This creates the alias
        await workspace.fs.readFile(theBadOneUri);

        // Then we write some 273 ebcdic to it
        await workspace.fs.writeFile(theBadOneUri, Buffer.from(lines, `utf8`));

        // Then we read it back as utf8!
        const rows = await component.runStatements(`SELECT * FROM ${tempLib}.${tempLib}_${file}_THEMEMBER`);
        assert.strictEqual(rows.length, 2);
        
        assert.strictEqual(rows.map(r => r.SRCDTA).join(`\n`), lines);
      }
    }
  ]
};
