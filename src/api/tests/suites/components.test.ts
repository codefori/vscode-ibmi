import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import IBMi from '../../IBMi';
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
