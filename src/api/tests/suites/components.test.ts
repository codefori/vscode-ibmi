import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GetMemberInfo } from '../../components/getMemberInfo';
import IBMi from '../../IBMi';
import { Tools } from '../../Tools';
import { CustomCLI } from '../components/customCli';
import { CONNECTION_TIMEOUT, disposeConnection, newConnection } from '../connection';

describe('Component Tests', () => {
  let connection: IBMi
  beforeAll(async () => {
    connection = await newConnection();
  }, CONNECTION_TIMEOUT)

  afterAll(async () => {
    await disposeConnection(connection);
  });

  it('Check getMemberInfo', async () => {
    const component = await connection?.getComponent<GetMemberInfo>(GetMemberInfo.ID)!;

    expect(component).toBeDefined();

    const memberInfoA = await component!.getMemberInfo(connection, `QSYSINC`, `H`, `MATH`);
    expect(memberInfoA).toBeTruthy();
    expect(memberInfoA?.library).toBe(`QSYSINC`);
    expect(memberInfoA?.file).toBe(`H`);
    expect(memberInfoA?.name).toBe(`MATH`);
    expect(memberInfoA?.extension).toBe(`C`);
    expect(memberInfoA?.text).toBe(`STANDARD HEADER FILE MATH`);

    const memberInfoB = await component!.getMemberInfo(connection, `QSYSINC`, `H`, `MEMORY`);
    expect(memberInfoB).toBeTruthy();
    expect(memberInfoB?.library).toBe(`QSYSINC`);
    expect(memberInfoB?.file).toBe(`H`);
    expect(memberInfoB?.name).toBe(`MEMORY`);
    expect(memberInfoB?.extension).toBe(`CPP`);
    expect(memberInfoB?.text).toBe(`C++ HEADER`);

    try {
      await component!.getMemberInfo(connection, `QSYSINC`, `H`, `OH_NONO`);
    } catch (error: any) {
      expect(error).toBeInstanceOf(Tools.SqlError);
      expect(error.sqlstate).toBe("38501");
    }

    // Check getMemberInfo for empty member.
    const tempLib = "QTEMP";
    const tempSPF = `O_ABC`.concat(connection!.variantChars.local);
    const tempMbr = `O_ABC`.concat(connection!.variantChars.local);

    const result = await connection!.runCommand({
      command: `QSYS/CRTSRCPF ${tempLib}/${tempSPF} MBR(${tempMbr})`,
      environment: 'ile'
    });
    if (result.code === 0) {
      const memberInfoC = await component!.getMemberInfo(connection, tempLib, tempSPF, tempMbr);
      expect(memberInfoC).toBeTruthy();
      expect(memberInfoC?.library).toBe(tempLib);
      expect(memberInfoC?.file).toBe(tempSPF);
      expect(memberInfoC?.name).toBe(tempMbr);
      expect(memberInfoC?.created).toBeTypeOf('object');
      expect(memberInfoC?.changed).toBeTypeOf('object');
    }
  });

  it('Can get component no matter the state', async () => {
    const componentA = await connection.getComponent<CustomCLI>(CustomCLI.ID, { ignoreState: true });
    expect(componentA).toBeDefined();
    expect(componentA?.getIdentification().version).toBe(1);
    expect(componentA?.getIdentification().userManaged).toBe(true);
  });

  it('Can install a component', async () => {
    const manager = connection.getComponentManager();

    try {
      await manager.uninstallComponent(CustomCLI.ID);
    } catch (e) {
      console.log(e);
      console.log(`Component not installed, skipping uninstall.`);
    }

    const requiredCheckA = await manager.getRemoteState(CustomCLI.ID);
    expect(requiredCheckA).toBeDefined();
    expect(requiredCheckA?.status).toBe(`NotInstalled`);

    const allComponents = manager.getComponentStates();
    expect(allComponents.length > 1).toBeTruthy();
    const state = allComponents.some(c => c.id.name === CustomCLI.ID && c.state.status === `NotInstalled`);
    expect(state).toBeTruthy();

    const version1 = connection.getComponent<CustomCLI>(CustomCLI.ID);
    expect(version1).toBeUndefined();

    const resultA = await manager.installComponent(CustomCLI.ID);
    expect(resultA.state.status).toBe(`Installed`);

    const requiredCheckB = await manager.getRemoteState(CustomCLI.ID);
    expect(requiredCheckB).toBeTruthy();
    expect(requiredCheckB?.status).toBe(`Installed`);

    try {
      await manager.installComponent(CustomCLI.ID);
      expect.fail(`Should not be able to install the same component twice.`);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
    }
  });
});
