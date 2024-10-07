import assert from "assert";
import tmp from 'tmp';
import util, { TextDecoder } from 'util';
import { Uri, workspace } from "vscode";
import { TestSuite } from ".";
import { Tools } from "../api/Tools";
import { instance } from "../instantiate";
import { CommandResult } from "../typings";
import { getMemberUri } from "../filesystems/qsys/QSysFs";
import { hasInvalidCharacters, replaceInvalidCharacters } from "../languages/colour";

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

export const EncodingSuite: TestSuite = {
  name: `Encoding tests`,
  before: async () => {
    const config = instance.getConfig()!;
    assert.ok(config.enableSourceDates, `Source dates must be enabled for this test.`);
  },

  tests: [
    ...Object.keys(contents).map(ccsid => {
      return {
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
      }
    }),
    {name: `Colour fix test`, test: async () => {
      const connection = instance.getConnection();
      const config = instance.getConfig()!;

      const tempLib = config!.tempLibrary;
      const file = `COLOURS`;
      const member = `THEMEMBER`;
      
      await connection!.runCommand({ command: `CRTSRCPF FILE(${tempLib}/${file}) RCDLEN(112)`, noLibList: true });
      await connection!.runCommand({ command: `ADDPFM FILE(${tempLib}/${file}) MBR(${member}) SRCTYPE(TXT)`, noLibList: true });

      const aliasName = `${tempLib}.test_${file}_${member}`;
      await connection?.runSQL(`CREATE OR REPLACE ALIAS ${aliasName} for "${tempLib}"."${file}"("${member}")`);

      try {
        await connection?.runSQL(`delete from ${aliasName}`);
      } catch (e) {}

      const lines = [
        `insert into ${aliasName} (srcseq, srcdat, srcdta)`,
        `values `,
        `  (01.00, 240805, '      // This illustrates 5250 attribute bytes.'),`,
        `  (02.00, 240805, '     '),`,
        // `--(05.00, 240805, '     C*' concat x'XX' concat 'X''XX''' concat x'404020' concat  'X''XX'' GRN RI UL BL CS ND'),`,
        `  (03.00, 240805, '     C*' concat x'20' concat 'X''20''' concat x'404020' concat  'X''20'' GRN               '),`,
        `  (04.00, 240805, '     C*' concat x'24' concat 'X''24''' concat x'404020' concat  'X''24'' GRN    UL         '),`,
        `  (05.00, 240805, '     C*' concat x'25' concat 'X''25''' concat x'404020' concat  'X''25'' GRN RI UL         '),`,
        `  (06.00, 240805, '     C*' concat x'2E' concat 'X''2E''' concat x'404020' concat  'X''2E'' RED    UL BL      '),`,
        `  (07.00, 240805, '     C*' concat x'2F' concat 'X''2F''' concat x'404020' concat  'X''2F'' RED             ND'),`,
        `  (08.00, 240805, '     C*' concat x'30' concat 'X''30''' concat x'404020' concat  'X''30'' TRQ          CS   '),`,
        `  (09.00, 240805, '     C*' concat x'36' concat 'X''36''' concat x'404020' concat  'X''36'' YLW          CS   '),`,
        `  (10.00, 240805, '     C*' concat x'37' concat 'X''37''' concat x'404020' concat  'X''37'' YLW          CS ND'),`,
        `  (11.00, 240805, '     C*' concat x'3D' concat 'X''3D''' concat x'404020' concat  'X''3D'' PNK RI UL         '),`,
        `  (12.00, 240805, '     C*' concat x'3E' concat 'X''3E''' concat x'404020' concat  'X''3E'' BLU    UL         '),`,
        `  (13.00, 240805, '     C*' concat x'3F' concat 'X''3F''' concat x'404020' concat  'X''3F'' revert to default '),`,
        `  (14.00, 240805, '     '),`,
        `  (15.00, 240805, '       *inlr = *on;'),`,
        `  (16.00, 240805, '       return;')`,
      ];

      await connection?.runSQL(lines.join(` `));

      const theBadOneUri = getMemberUri({ library: tempLib, file, name: member, extension: `TXT` });

      const memberContentBuf = await workspace.fs.readFile(theBadOneUri);
      const fileContent = new TextDecoder().decode(memberContentBuf);

      assert.ok(hasInvalidCharacters(fileContent));

      const newContent = replaceInvalidCharacters(fileContent);

      assert.notStrictEqual(newContent, fileContent);

      assert.ok(hasInvalidCharacters(newContent));
    }}
  ]
};
