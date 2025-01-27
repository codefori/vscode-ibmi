import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { parseFilter } from '../../Filter';
import { Search } from '../../Search';
import IBMi from '../../IBMi';
import { newConnection, disposeConnection, CONNECTION_TIMEOUT } from '../connection';

describe('Search Tests', {concurrent: true}, () => {
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
  });

  it('Filtered members list search', async () => {
    const pfgrep = connection.remoteFeatures.pfgrep;
    // This test only needs to run if pfgrep is installed
    if (pfgrep) {
      const resultPfgrep = await Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", "CMRPG");
      connection.remoteFeatures.pfgrep = undefined;
      const resultQsh = await Search.searchMembers(connection, "QSYSINC", "QRPGLESRC", "IBM", "CMRPG");
      connection.remoteFeatures.pfgrep = pfgrep;
      // XXX: Do a deep equals here (without having to reimplement one)
      expect(resultPfgrep.hits[0].lines[0] == resultQsh.hits[0].lines[0]);
    } else {
      expect(true)
    }
  });
});
