import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GetMemberInfo } from '../../components/getMemberInfo';
import { GetNewLibl } from '../../components/getNewLibl';
import { Tools } from '../../Tools';
import IBMi from '../../IBMi';
import { CONNECTION_TIMEOUT, disposeConnection, newConnection } from '../connection';

describe('Component Tests', () => {
  let connection: IBMi
  beforeAll(async () => {
    connection = await newConnection();
  }, CONNECTION_TIMEOUT)

  afterAll(async () => {
    disposeConnection(connection);
  });

  it('Get new libl', async () => {
    const component = connection.getComponent<GetNewLibl>(GetNewLibl.ID);

    if (component) {
      const newLibl = await component.getLibraryListFromCommand(connection, `CHGLIBL CURLIB(SYSTOOLS)`);
      expect(newLibl?.currentLibrary).toBe(`SYSTOOLS`);
    } else {
      throw new Error(`Component not installed`);
    }
  });

  it('Check getMemberInfo', async () => {
    const component = connection?.getComponent<GetMemberInfo>(GetMemberInfo.ID)!;

    expect(component).toBeTruthy();

    const memberInfoA = await component.getMemberInfo(connection, `QSYSINC`, `H`, `MATH`);
    expect(memberInfoA).toBeTruthy();
    expect(memberInfoA?.library).toBe(`QSYSINC`);
    expect(memberInfoA?.file).toBe(`H`);
    expect(memberInfoA?.name).toBe(`MATH`);
    expect(memberInfoA?.extension).toBe(`C`);
    expect(memberInfoA?.text).toBe(`STANDARD HEADER FILE MATH`);

    const memberInfoB = await component.getMemberInfo(connection, `QSYSINC`, `H`, `MEMORY`);
    expect(memberInfoB).toBeTruthy();
    expect(memberInfoB?.library).toBe(`QSYSINC`);
    expect(memberInfoB?.file).toBe(`H`);
    expect(memberInfoB?.name).toBe(`MEMORY`);
    expect(memberInfoB?.extension).toBe(`CPP`);
    expect(memberInfoB?.text).toBe(`C++ HEADER`);

    try {
      await component.getMemberInfo(connection, `QSYSINC`, `H`, `OH_NONO`);
    } catch (error: any) {
      expect(error).toBeInstanceOf(Tools.SqlError);
      expect(error.sqlstate).toBe("38501");
    }
  });
});
