import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import IBMi from '../../IBMi';
import { Tools } from '../../Tools';
import { CONNECTION_TIMEOUT, disposeConnection, newConnection } from '../connection';

describe('member locking integration tests', () => {
  let connection: IBMi;

  beforeAll(async () => {
    connection = await newConnection();
  }, CONNECTION_TIMEOUT * 3);

  afterAll(async () => {
    await disposeConnection(connection);
  });

  it('blocks a second Mapepire job and releases members independently', async () => {
    const sourceFile = `O_LCK${Date.now().toString().slice(-5)}`;
    const library = connection.getConfig().tempLibrary;
    const object = `${library}/${sourceFile} *FILE`;
    const firstMember = 'LOCKONE';
    const secondMember = 'LOCKTWO';
    let secondConnection: IBMi | undefined;
    const firstConnectionLocks = new Set<string>();
    const secondConnectionLocks = new Set<string>();

    const acquire = (member: string) => `@ALCOBJ OBJ((${object} *EXCLRD ${member})) WAIT(0)`;
    const release = (member: string) => `@DLCOBJ OBJ((${object} *EXCLRD ${member}))`;

    try {
      await connection.runCommand({
        command: `QSYS/CRTSRCPF FILE(${library}/${sourceFile}) MBR(${firstMember})`,
        environment: 'ile'
      });
      await connection.runCommand({
        command: `QSYS/ADDPFM FILE(${library}/${sourceFile}) MBR(${secondMember})`,
        environment: 'ile'
      });
      await connection.runSQL(acquire(firstMember));
      firstConnectionLocks.add(firstMember);
      await connection.runSQL(acquire(secondMember));
      firstConnectionLocks.add(secondMember);

      secondConnection = await newConnection();
      await expect(secondConnection.runSQL(acquire(firstMember))).rejects.toSatisfy((error: unknown) =>
        error instanceof Tools.SqlError && error.message.includes('CPF1002')
      );
      await connection.runSQL(release(firstMember));
      firstConnectionLocks.delete(firstMember);
      await expect(secondConnection.runSQL(acquire(firstMember))).resolves.toEqual([]);
      secondConnectionLocks.add(firstMember);

      await expect(secondConnection.runSQL(acquire(secondMember))).rejects.toSatisfy((error: unknown) =>
        error instanceof Tools.SqlError && error.message.includes('CPF1002')
      );
    } finally {
      if (secondConnection) {
        for (const member of secondConnectionLocks) {
          await secondConnection.runSQL(release(member)).catch(() => undefined);
        }
      }
      for (const member of firstConnectionLocks) {
        await connection.runSQL(release(member)).catch(() => undefined);
      }
      await disposeConnection(secondConnection);
      await connection.runCommand({
        command: `QSYS/DLTF FILE(${library}/${sourceFile})`,
        environment: 'ile'
      });
    }
  }, CONNECTION_TIMEOUT * 3);
});