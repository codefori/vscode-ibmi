import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFilter } from '../../Filter';
import IBMi from '../../IBMi';
import { SearchTools } from '../../SearchTools';
import { Tools } from '../../Tools';
import { SearchResults } from '../../types';
import { disposeConnection, envVars, newConnection } from '../setup/connection';

describe('Search Tests', { concurrent: true }, () => {
  let connection: IBMi
  beforeAll(async () => {
    connection = await newConnection();
  }, envVars.VITE_CONNECTION_TIMEOUT)

  afterAll(async () => {
    await disposeConnection(connection);
  });

  it('Single member search', async () => {
    const result = await SearchTools.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", "CMRPG");
    expect(result.term).toBe("IBM");
    expect(result.hits.length).toBe(1);
    const [hit] = result.hits;
    expect(hit.lines.length).toBe(3);

    const checkLine = (index: number, expectedNumber: number) => {
      expect(hit.lines[index].number).toBe(expectedNumber);
      expect(hit.lines[index].content).toContain(result.term);
    }

    checkLine(0, 7);
    checkLine(1, 11);
    checkLine(2, 13);
  });

  it('Generic name search', async () => {
    const memberFilter = "E*";
    const filter = parseFilter(memberFilter);
    const result = await SearchTools.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", memberFilter);
    expect(result.hits.every(hit => filter.test(hit.path.split("/").at(-1)!))).toBe(true);
    expect(result.hits.every(hit => !hit.path.endsWith(`MBR`))).toBe(true);
  });

  it('Filtered members list search', async () => {
    const library = "QSYSINC";
    const sourceFile = "QRPGLESRC";
    const memberFilter = "S*,T*";
    const filter = parseFilter(memberFilter);
    const checkNames = (names: string[]) => names.every(filter.test);

    const members = await connection.getContent().getMemberList({ library, sourceFile, members: memberFilter });
    expect(checkNames(members.map(member => member.name))).toBe(true);

    const result = await SearchTools.searchMembers(connection, "QSYSINC", "QRPGLESRC", "SQL", members);
    expect(result.hits.length).toBe(6);
    expect(checkNames(result.hits.map(hit => hit.path.split("/").at(-1)!))).toBe(true);
    expect(result.hits.every(hit => !hit.path.endsWith(`MBR`))).toBe(true);
  }),

    it('Member with `.` in name search', async () => {
      const library = connection.getConfig().tempLibrary;
      const file = connection.upperCaseName(`ZZ${Tools.makeid(6)}`);
      const crtsrcpf = await connection.runCommand({ command: `QSYS/CRTSRCPF FILE(${library}/${file}) RCDLEN(112)`, noLibList: true });
      if (crtsrcpf.code !== 0) {
        throw new Error(`Failed to create test source file: ${crtsrcpf.stderr}`);
      }
      try {
        const members = [
          { name: "AN.RPGLE", type: "RPGLE", content: ["Some random text", "nobody will read", "but that's for testing"] },
          { name: "A.CLLE", type: "CLLE", content: ["More random text", "testing is fun", "or so they say"] },
          { name: "A.CMD", type: "CMD", content: ["This is not valid for a command", "this is for a test", "so I guess it's fine"] }
        ];

        for (const member of members) {
          const addpfm = await connection.runCommand({ command: `QSYS/ADDPFM FILE(${library}/${file}) MBR(${member.name}) SRCTYPE(${member.type})`, noLibList: true });
          if (addpfm.code !== 0) {
            throw new Error(`Failed to add test member: ${addpfm.stderr}`);
          }
          await connection.getContent().uploadMemberContent(library, file, member.name, member.content.join("\n"));
        }

        const hasMember = (results: SearchResults, member: string) => results.hits.map(hit => hit.path.split('/').pop()).includes(member);

        const searchTest = await SearchTools.searchMembers(connection, library, file, "test", '*');
        expect(searchTest.hits.length).toBe(3);
        expect(hasMember(searchTest, "AN.RPGLE.RPGLE")).toBe(true);
        expect(hasMember(searchTest, "A.CLLE.CLLE")).toBe(true);
        expect(hasMember(searchTest, "A.CMD.CMD")).toBe(true);

        const searchTesting = await SearchTools.searchMembers(connection, library, file, "testing", '*');
        expect(searchTesting.hits.length).toBe(2);
        expect(hasMember(searchTesting, "AN.RPGLE.RPGLE")).toBe(true);
        expect(hasMember(searchTesting, "A.CLLE.CLLE")).toBe(true);
        expect(hasMember(searchTesting, "A.CMD.CMD")).toBe(false);
      }
      finally {
        await connection.runCommand({ command: `QSYS/DLTF FILE(${library}/${file})`, noLibList: true });
      }
    });

  it('Search special characters', async () => {
    const library = connection.getConfig().tempLibrary;
    const file = connection.upperCaseName(`ZZ${Tools.makeid(6)}`);
    const crtsrcpf = await connection.runCommand({ command: `QSYS/CRTSRCPF FILE(${library}/${file}) RCDLEN(112)`, noLibList: true });
    if (crtsrcpf.code !== 0) {
      throw new Error(`Failed to create test source file: ${crtsrcpf.stderr}`);
    }
    try {
      const members = [
        { name: "FIRST", type: "RPGLE", content: ["//a comment with $", "//some ^ special \\characters \"hi\"", "//** stars!"] },
        { name: "SECOND", type: "CLLE", content: ["DCL $VAR something", "/* 'quoted comment' */", "/* more $; in comments */"] },
        { name: "THIRD", type: "CMD", content: ["£ pound", "$ dollar", "€ euro", "% percent", "[ thing", "@ at", "# hash"] }
      ];

      for (const member of members) {
        const addpfm = await connection.runCommand({ command: `QSYS/ADDPFM FILE(${library}/${file}) MBR(${member.name}) SRCTYPE(${member.type})`, noLibList: true });
        if (addpfm.code !== 0) {
          throw new Error(`Failed to add test member: ${addpfm.stderr}`);
        }
        await connection.getContent().uploadMemberContent(library, file, member.name, member.content.join("\n"));
      }

      const hasMember = (results: SearchResults, member: string) => results.hits.map(hit => hit.path.split('/').pop()).includes(member);
      
      const searchDollar = await SearchTools.searchMembers(connection, library, file, "$", '*');
      expect(searchDollar.hits.length).toBe(3);
      expect(hasMember(searchDollar, "FIRST.RPGLE")).toBe(true);
      expect(hasMember(searchDollar, "SECOND.CLLE")).toBe(true);      
      expect(hasMember(searchDollar, "THIRD.CMD")).toBe(true);

      const searchDollarVar = await SearchTools.searchMembers(connection, library, file, "$VAR", '*');
      expect(searchDollarVar.hits.length).toBe(1);
      expect(hasMember(searchDollarVar, "SECOND.CLLE")).toBe(true);

      const searchQuote = await SearchTools.searchMembers(connection, library, file, "'quote", '*');
      expect(searchQuote.hits.length).toBe(1);
      expect(hasMember(searchQuote, "SECOND.CLLE")).toBe(true);

      const searchBackslash = await SearchTools.searchMembers(connection, library, file, "\\char", '*');
      expect(searchBackslash.hits.length).toBe(1);
      expect(hasMember(searchBackslash, "FIRST.RPGLE")).toBe(true);

      const searchDoubleQuote = await SearchTools.searchMembers(connection, library, file, '"hi"', '*');
      expect(searchDoubleQuote.hits.length).toBe(1);
      expect(hasMember(searchDoubleQuote, "FIRST.RPGLE")).toBe(true);

      const searchStar = await SearchTools.searchMembers(connection, library, file, "*", '*');
      expect(searchStar.hits.length).toBe(2);
      expect(hasMember(searchStar, "FIRST.RPGLE")).toBe(true);
      expect(hasMember(searchStar, "SECOND.CLLE")).toBe(true);

      const searchPound = await SearchTools.searchMembers(connection, library, file, "£", '*');
      expect(searchPound.hits.length).toBe(1);
      expect(hasMember(searchPound, "THIRD.CMD")).toBe(true);

      const searchHash = await SearchTools.searchMembers(connection, library, file, "#", '*');
      expect(searchHash.hits.length).toBe(1);
      expect(hasMember(searchHash, "THIRD.CMD")).toBe(true);

      const searchAt = await SearchTools.searchMembers(connection, library, file, "@ ", '*');
      expect(searchAt.hits.length).toBe(1);
      expect(hasMember(searchAt, "THIRD.CMD")).toBe(true);
    }
    finally {
      await connection.runCommand({ command: `QSYS/DLTF FILE(${library}/${file})`, noLibList: true });
    }
  });

  it('Filtered members list search', async () => {
    const pfgrep = connection.remoteFeatures.pfgrep;
    // This test only needs to run if pfgrep is installed
    if (pfgrep) {
      const resultPfgrep = await SearchTools.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", "CMRPG");
      connection.remoteFeatures.pfgrep = undefined;
      const resultQsh = await SearchTools.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", "CMRPG");
      connection.remoteFeatures.pfgrep = pfgrep;
      // XXX: Do a deep equals here (without having to reimplement one)
      expect(resultPfgrep.hits[0].lines[0] == resultQsh.hits[0].lines[0]);
    } else {
      expect(true)
    }
  });
});
