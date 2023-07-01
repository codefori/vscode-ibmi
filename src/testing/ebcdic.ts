import assert from "assert";
import { TestSuite } from ".";
import { instance } from "../instantiate";
import { escapeString } from "../filesystems/qsys/extendedContent";
import { getAliasName } from "../filesystems/qsys/sourceDateHandler";

import util from "util";
import fs from "fs";
import tmp from "tmp";

const tmpFile = util.promisify(tmp.file);
const writeFileAsync = util.promisify(fs.writeFile);

const string_37 = `âäàáãåçñ¢.<(+|&éêëèíîïìß!$*);¬-/ÂÄÀÁÃÅÇÑ¦,%_>?øÉÊËÈÍÎÏÌ\`:#@'="Øabcdefghi«»ðýþ±°jklmnopqrªºæ¸Æ¤µ~stuvwxyz¡¿ÐÝÞ®^£¥·©§¶¼½¾[]¯¨´×{ABCDEFGHI­ôöòóõ}JKLMNOPQR¹ûüùúÿ\÷STUVWXYZ²ÔÖÒÓÕ0123456789³ÛÜÙÚ`;

export const EbcdicSuite: TestSuite = {
  name: `Member writing tests`,
  tests: [
    {name: `Restore source files`, test: async () => {
      const connection = instance.getConnection();
      const config = instance.getConfig();
      const tempLib = config?.tempLibrary;
      
      // First delete all files
      await connection?.runCommand({
        command: `DLTOBJ ${tempLib}/SOURCE37 *FILE`,
        environment: `ile`
      });

      // Then create some
      await connection?.runCommand({
        command: `CRTSRCPF FILE(${tempLib}/SOURCE37) MBR(INDEX) CCSID(37) RCDLEN(300)`,
        environment: `ile`
      });
    }},

    {name: `Simple 37 test (no-SQL)`, test: async () => {
      const content = instance.getContent();
      const config = instance.getConfig();
      const tempLib = config?.tempLibrary!;

      await content?.uploadMemberContent(undefined, tempLib, `SOURCE37`, `INDEX`, string_37);

      const downloaded = await content?.downloadMemberContent(undefined, tempLib, `SOURCE37`, `INDEX`, undefined);

      assert.strictEqual(string_37 + `\r\n`, downloaded);
    }},

    {name: `Simple 37 test (SQL)`, test: async () => {
      const content = instance.getContent()!;
      const config = instance.getConfig();
      const tempLib = config?.tempLibrary!;

      assert.strictEqual(config?.enableSQL, true, `SQL must be enabled`);

      const aliasName = getAliasName(tempLib, `SOURCE37`, `INDEX`);
      const aliasPath = `${tempLib}.${aliasName}`;

      await content.runSQL(`CREATE OR REPLACE ALIAS ${aliasPath} for "${tempLib}"."SOURCE37"("INDEX")`);

      await writeLinesWithSQL(aliasPath, [string_37]);

      const downloaded = (await getLinesWithSQL(aliasPath));

      assert.strictEqual(string_37, downloaded);
    }}
  ]
}

// This is a reimplementation of extendedContent.uploadMemberContentWithDates
async function writeLinesWithSQL(aliasPath: string, sourceData: string[]) {
  const connection = instance.getConnection()!;
  const client = connection.client;
  const setccsid = connection.remoteFeatures.setccsid;

  let query = [];
  let rows = [];

  for (let i = 0; i < sourceData.length; i++) {
    rows.push(
      `(${i}, 0, '${escapeString(sourceData[i])}')`,
    );
  }

  const tempRmt = connection.getTempRemote(aliasPath)!;
  const tmpobj = await tmpFile();

  query.push(
    `delete ${aliasPath};`,
    `insert into ${aliasPath} values ${rows.join(`, `)};`
  )

  await writeFileAsync(tmpobj, query.join(`\n`), `utf8`);
  await client.putFile(tmpobj, tempRmt);

  if (setccsid) await connection.paseCommand(`${setccsid} 1208 ${tempRmt}`);
  await connection.remoteCommand(
    `QSYS/RUNSQLSTM SRCSTMF('${tempRmt}') COMMIT(*NONE) NAMING(*SQL)`,
  );
}

async function getLinesWithSQL(aliasPath: string) {
  const content = instance.getContent()!;
  const rows = await content.runSQL(
    `select srcdta from ${aliasPath}`
  );

  const body = rows
    .map(row => row.SRCDTA)
    .join(`\r\n`);

  return body;
}