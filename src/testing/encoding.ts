import assert from "assert";
import tmp from 'tmp';
import util, { TextDecoder } from 'util';
import { Uri, workspace } from "vscode";
import { TestSuite } from ".";
import { Tools } from "../api/Tools";
import { instance } from "../instantiate";
import { CommandResult } from "../typings";
import { getMemberUri } from "../filesystems/qsys/QSysFs";

const contents = {
  '37': [`Hello world`],
  '273': [`Hello world`, `àáãÄÜö£øß`],
  '277': [`Hello world`, `çñßØ¢åæ`],
  '297': [`Hello world`, `âÑéè¥ýÝÞã`],
  '290': [`Hello world`, `ｦｯ!ﾓﾄｴﾜﾈﾁｾ`],
  '420': [`Hello world`, `ص ث ب ﻷ`],
}

export const EncodingSuite: TestSuite = {
  name: `Encoding tests`,
  before: async () => {
    const config = instance.getConfig()!;
    assert.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);
  },
  tests:
    Object.keys(contents).map(ccsid => {
      return {
        name: `Encoding ${ccsid}`, test: async () => {
          const connection = instance.getConnection();
          const config = instance.getConfig()!;

          const lines = contents[ccsid as keyof typeof contents].join(`\n`);

          const tempLib = config!.tempLibrary;

          const file = `TEST${ccsid}`;

          await connection!.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${file}) RCDLEN(112) CCSID(${ccsid})`, noLibList: true });
          await connection!.runCommand({ command: `ADDPFM FILE(${tempLib}/${file}) MBR(THEMEMBER) SRCTYPE(TXT)`, noLibList: true });

          const theBadOneUri = getMemberUri({ library: tempLib, file, name: `THEMEMBER`, extension: `TXT` });

          await workspace.fs.readFile(theBadOneUri);

          await workspace.fs.writeFile(theBadOneUri, Buffer.from(lines, `utf8`));

          const memberContentBuf = await workspace.fs.readFile(theBadOneUri);
          const fileContent = new TextDecoder().decode(memberContentBuf)
          
          assert.strictEqual(fileContent, lines);
        },
      }
    })
};
