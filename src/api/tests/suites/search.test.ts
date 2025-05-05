import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFilter } from '../../Filter';
import IBMi from '../../IBMi';
import { Search } from '../../Search';
import { Tools } from '../../Tools';
import { SearchResults } from '../../types';
import { CONNECTION_TIMEOUT, disposeConnection, newConnection } from '../connection';

describe('Search Tests', { concurrent: true }, () => {
  let connection: IBMi
  beforeAll(async () => {
    connection = await newConnection();
  }, CONNECTION_TIMEOUT)

  afterAll(async () => {
    disposeConnection(connection);
  });

  it('Single member search', async () => {
    const result = await Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", "CMRPG");
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
    const result = await Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", memberFilter);
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

    const result = await Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "SQL", members);
    expect(result.hits.length).toBe(6);
    expect(checkNames(result.hits.map(hit => hit.path.split("/").at(-1)!))).toBe(true);
    expect(result.hits.every(hit => !hit.path.endsWith(`MBR`))).toBe(true);
  }),

    it('Member with `.` in name search', async () => {
      const library = connection.getConfig().tempLibrary;
      const file = `ZZ${Tools.makeid(6)}`;
      const crtsrcpf = await connection.runCommand({ command: `CRTSRCPF FILE(${library}/${file}) RCDLEN(112)`, noLibList: true });
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
          const addpfm = await connection.runCommand({ command: `ADDPFM FILE(${library}/${file}) MBR(${member.name}) SRCTYPE(${member.type})`, noLibList: true });
          if (addpfm.code !== 0) {
            throw new Error(`Failed to add test member: ${addpfm.stderr}`);
          }
          await connection.getContent().uploadMemberContent(library, file, member.name, member.content.join("\n"));
        }

        const hasMember = (results: SearchResults, member: string) => results.hits.map(hit => hit.path.split('/').pop()).includes(member);

        const searchTest = await Search.searchMembers(connection, library, file, "test", '*');
        expect(searchTest.hits.length).toBe(3);
        expect(hasMember(searchTest, "AN.RPGLE")).toBe(true);
        expect(hasMember(searchTest, "A.CLLE")).toBe(true);
        expect(hasMember(searchTest, "A.CMD")).toBe(true);

        const searchTesting = await Search.searchMembers(connection, library, file, "testing", '*');
        expect(searchTesting.hits.length).toBe(2);
        expect(hasMember(searchTesting, "AN.RPGLE")).toBe(true);
        expect(hasMember(searchTesting, "A.CLLE")).toBe(true);
        expect(hasMember(searchTesting, "A.CMD")).toBe(false);
      }
      finally {
        await connection.runCommand({ command: `DLTF FILE(${library} / ${file})`, noLibList: true });
      }
    });
});
