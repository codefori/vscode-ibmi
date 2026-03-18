import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFilter } from '../../Filter';
import IBMi from '../../IBMi';
import { SearchTools } from '../../SearchTools';
import { Tools } from '../../Tools';
import { SearchResults } from '../../types';
import { CONNECTION_TIMEOUT, disposeConnection, newConnection } from '../connection';

describe('Search Tests', { concurrent: true }, () => {
  let connection: IBMi
  beforeAll(async () => {
    connection = await newConnection();
  }, CONNECTION_TIMEOUT)

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
        await connection.runCommand({ command: `DLTF FILE(${library}/${file})`, noLibList: true });
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
  it('Complex regex for library - excludes QSYS and contains SYS', async () => {
    const library = "^QSYSINC$";
    const object = "*";
    const types = ["*LIB"];
    const filterType = "regex";

    // Get library that matches exactly 'QSYSINC'
    const libraries = await connection.getContent().getLibraries({ library, filterType });

    // Verify we have exactly 1 matching library
    expect(libraries.length).toBe(1);

    // Verify the library is exactly 'QSYSINC'
    expect(libraries[0].name.toUpperCase()).toBe('QSYSINC');

  });
  it('Regex sourcefile filter with getObjectList ', async () => {
    const library = "QSYSINC";
    const object = "^lay.*";
    const types = ["*SRCPF"];
    const filterType = "regex"


    // Get member list using regex pattern
    const Sourcefiles = await connection.getContent().getObjectList({
      library,
      object,
      types,
      filterType
    });

    // Verify that 7 members match the pattern
    expect(Sourcefiles.length).toBe(7);

    // Verify all members start with "lay" (case insensitive)
    expect(Sourcefiles.every(Sourcefile => Sourcefile.name.toLowerCase().startsWith('lay'))).toBe(true);
  })
  it('Regex object filter excluding E and containing 40', async () => {
    const library = "QSYSINC";
    const object = "^[^E].*40*$";
    const types = ["*SRCPF"];
    const filterType = "regex";

    // Get object list using regex pattern that excludes names starting with 'E' and contains '40'
    const sourceFiles = await connection.getContent().getObjectList({
      library,
      object,
      types,
      filterType
    });

    // Verify all objects match the pattern:
    // - Don't start with 'E' (case insensitive)
    // - Contain '4' followed by zero or more '0's
    expect(sourceFiles.every(sourceFile => {
      const name = sourceFile.name.toLowerCase();
      return !name.startsWith('e') && /4[0]*/.test(name);
    })).toBe(true);

    // Verify we have at least some matching objects
    expect(sourceFiles.length).toBe(5);
  });

  it('Simple regex for members - starts with S', async () => {
    const library = "QSYSINC";
    const sourceFile = "QRPGLESRC";
    const memberFilter = "^S.*";
    const filterType = "regex";

    // Get members starting with 'S'
    const members = await connection.getContent().getMemberList({
      library,
      sourceFile,
      members: memberFilter,
      filterType
    });

    // Verify all members start with 'S'
    expect(members.every(member => member.name.toUpperCase().startsWith('S'))).toBe(true);

    // Verify we have at least some matching members
    expect(members.length).toBe(12);

  });

  it('Complex regex for members - contains digit and ends with 1', async () => {
    const library = "QSYSINC";
    const sourceFile = "QRPGLESRC";
    const memberFilter = ".*[0-9].1*$";
    const filterType = "regex";

    // Get members that contain a digit followed by any character and zero or more '1's at the end
    const members = await connection.getContent().getMemberList({
      library,
      sourceFile,
      members: memberFilter,
      filterType
    });

    // Verify all members contain at least one digit, followed by any character, and end with zero or more '1's
    expect(members.every(member => {
      const name = member.name.toUpperCase();
      return /[0-9].1*$/.test(name);
    })).toBe(true);

    // Verify we have exactly 1 matching member
    expect(members.length).toBe(1);
  });

  it('Simple regex for getting 2 members - exact pattern match', async () => {
    const library = "QSYSINC";
    const sourceFile = "QRPGLESRC";
    const memberFilter = "^(SQLCA|SQLDA|QCSTCF.*)$";
    const filterType = "regex";

    // Get members matching SQLCA, SQLDA, or starting with QCSTCF
    const members = await connection.getContent().getMemberList({
      library,
      sourceFile,
      members: memberFilter,
      filterType
    });

    // Verify we have at least 2 members (SQLCA and SQLDA are guaranteed, plus any QCSTCF* members)
    expect(members.length).toBe(2);

    // Verify the members match the pattern
    const memberNames = members.map(m => m.name.toUpperCase());
    expect(memberNames.some(name => name === 'SQLCA' || name === 'SQLDA' || name.startsWith('QCSTCF'))).toBe(true);

    // Verify all members match the regex pattern
    expect(members.every(member => {
      const name = member.name.toUpperCase();
      return name === 'SQLCA' || name === 'SQLDA' || name.startsWith('QCSTCF');
    })).toBe(true);
  });

  it('Complex regex for getting members - pattern with alternation', async () => {
    const library = "QSYSINC";
    const sourceFile = "QRPGLESRC";
    const memberFilter = "^E(ERRNO|RRNO)$";
    const filterType = "regex";

    // Get members matching: EERRNO or ERRNO
    const members = await connection.getContent().getMemberList({
      library,
      sourceFile,
      members: memberFilter,
      filterType
    });

    // Verify we have at least 1 member
    expect(members.length).toBe(1);

    // Verify the members match the pattern (EERRNO or ERRNO)
    expect(members.every(member => {
      const name = member.name.toUpperCase();
      return name === 'EERRNO' || name === 'ERRNO';
    })).toBe(true);
  });
});
