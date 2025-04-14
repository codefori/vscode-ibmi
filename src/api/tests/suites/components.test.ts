import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GetMemberInfo } from '../../components/getMemberInfo';
import { GetNewLibl } from '../../components/getNewLibl';
import { Tools } from '../../Tools';
import IBMi from '../../IBMi';
import { CONNECTION_TIMEOUT, disposeConnection, newConnection } from '../connection';
import { CustomCLI1 } from '../components/customCli1';
import { CustomCLI2 } from '../components/customCli2';

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

    // Check getMemberInfo for empty member.
    const config = connection.getConfig();
    const tempLib = config!.tempLibrary,
      tempSPF = `O_ABC`.concat(connection!.variantChars.local),
      tempMbr = `O_ABC`.concat(connection!.variantChars.local);

    const result = await connection!.runCommand({
      command: `CRTSRCPF ${tempLib}/${tempSPF} MBR(${tempMbr})`,
      environment: 'ile'
    });

    const memberInfoC = await component.getMemberInfo(connection, tempLib, tempSPF, tempMbr);
    expect(memberInfoC).toBeTruthy();
    expect(memberInfoC?.library).toBe(tempLib);
    expect(memberInfoC?.file).toBe(tempSPF);
    expect(memberInfoC?.name).toBe(tempMbr);
    expect(memberInfoC?.created).toBeTypeOf('object');
    expect(memberInfoC?.changed).toBeTypeOf('object');

    // Cleanup...
    await connection!.runCommand({
      command: `DLTF ${tempLib}/${tempSPF}`,
      environment: 'ile'
    });
  });

  it('Has multiple versions not installed(?)', async () => {
    const componentA = connection.getComponent<CustomCLI1>(CustomCLI1.ID, {ignoreState: true});
    expect(componentA).toBeDefined();
    expect(componentA?.getIdentification().version).toBe(1);
    expect(componentA?.getIdentification().userManaged).toBe(true);
  });

  it('Can install a component', async () => {
    try {
      await connection.getComponentManager().uninstall(CustomCLI1.ID);
    } catch (e) {}

    const version1 = connection.getComponent<CustomCLI1>(CustomCLI1.ID);
    expect(version1).toBeUndefined();

    const resultA = await connection.getComponentManager().install(CustomCLI1.ID);
    expect(resultA).toBe(`Installed`);

    try {
      await connection.getComponentManager().install(CustomCLI1.ID);
      expect.fail(`Should not be able to install the same component twice.`);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  });
});
