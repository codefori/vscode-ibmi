import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONNECTION_TIMEOUT, disposeConnection, newConnection } from '../connection';
import IBMi, { MemberParts } from '../../IBMi';
import { MemberLocks } from '../../memberLocks';
import { Tools } from '../../Tools';

describe(`Member Lock Tests`, () => {
  let connection: IBMi;
  let tempLib: string;
  let tempFile: string;

  let qualifiedJobName: string;

  beforeAll(async () => {
    connection = await newConnection();
    const config = connection.getConfig();

    tempLib = connection.upperCaseName(config.tempLibrary);
    tempFile = connection.upperCaseName(Tools.makeid(8));

    const [jobRow] = await connection.runSQL(`VALUES QSYS2.JOB_NAME`);
    qualifiedJobName = String(jobRow["00001"]);

    const createFile = await connection.runCommand({
      command: `QSYS/CRTSRCPF FILE(${tempLib}/${tempFile}) RCDLEN(112)`,
      noLibList: true
    });
    expect(createFile.code).toBe(0);

    for (const mbr of [`MBR1`, `MBR2`, `MBR3`, `MBR4`]) {
      const addMember = await connection.runCommand({
        command: `QSYS/ADDPFM FILE(${tempLib}/${tempFile}) MBR(${mbr}) SRCTYPE(RPGLE)`,
        noLibList: true
      });
      if (addMember.code !== 0) {
        throw new Error(`Failed to create member ${mbr}: ${addMember.stderr}`);
      }
    }
  }, CONNECTION_TIMEOUT);

  afterAll(async () => {
    await connection.runCommand({
      command: `QSYS/DLTF FILE(${tempLib}/${tempFile})`,
      noLibList: true
    });
    await disposeConnection(connection);
  });

  function member(name: string): MemberParts {
    return { library: tempLib, file: tempFile, name, extension: `RPGLE`, basename: `${name}.RPGLE` };
  }

  async function validateIsLocked(locks: MemberLocks, memberParts: MemberParts, expected: boolean): Promise<void> {
    expect(locks.isLocked(memberParts)).toBe(expected);

    const rows = await connection.runSQL([
      `SELECT * FROM QSYS2.OBJECT_LOCK_INFO`,
      `    WHERE SYSTEM_OBJECT_SCHEMA = '${memberParts.library}'`,
      `    AND SYSTEM_OBJECT_NAME = '${memberParts.file}'`,
      `    AND OBJECT_TYPE = '*FILE'`,
      `    AND SYSTEM_TABLE_MEMBER = '${memberParts.name}'`,
      `    AND JOB_NAME = '${qualifiedJobName}'`,
    ].join(`\n`));

    if (expected) {
      expect(rows.length).toBeGreaterThan(0);
    } else {
      expect(rows.length).toBe(0);
    }
  }

  it(`Standard allocate and deallocate lifecycle`, async () => {
    const locks = new MemberLocks();

    // Allocate MBR1, MBR2, MBR3 — skip MBR4
    expect(await locks.allocate(connection, member(`MBR1`))).toBe(true);
    expect(await locks.allocate(connection, member(`MBR2`))).toBe(true);
    expect(await locks.allocate(connection, member(`MBR3`))).toBe(true);

    await validateIsLocked(locks, member(`MBR1`), true);
    await validateIsLocked(locks, member(`MBR2`), true);
    await validateIsLocked(locks, member(`MBR3`), true);
    await validateIsLocked(locks, member(`MBR4`), false);

    // Deallocate MBR1
    expect(await locks.deallocate(connection, member(`MBR1`))).toBe(true);

    await validateIsLocked(locks, member(`MBR1`), false);
    await validateIsLocked(locks, member(`MBR2`), true);
    await validateIsLocked(locks, member(`MBR3`), true);
    await validateIsLocked(locks, member(`MBR4`), false);

    // Deallocate all
    await locks.deallocateAll(connection);

    await validateIsLocked(locks, member(`MBR1`), false);
    await validateIsLocked(locks, member(`MBR2`), false);
    await validateIsLocked(locks, member(`MBR3`), false);
    await validateIsLocked(locks, member(`MBR4`), false);
  });

  it(`Allocate a non-existent member`, async () => {
    const locks = new MemberLocks();

    const result = await locks.allocate(connection, member(`NOEXIST`));

    expect(result).toBe(false);
    await validateIsLocked(locks, member(`NOEXIST`), false);
  });

  it(`Deallocate a non-existent member`, async () => {
    const locks = new MemberLocks();

    const result = await locks.deallocate(connection, member(`NOEXIST`));

    expect(result).toBe(false);
    await validateIsLocked(locks, member(`NOEXIST`), false);
  });
});
