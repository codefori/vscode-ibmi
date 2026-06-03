"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const getMemberInfo_1 = require("../../components/getMemberInfo");
const getNewLibl_1 = require("../../components/getNewLibl");
const Tools_1 = require("../../Tools");
const customCli_1 = require("../components/customCli");
const connection_1 = require("../connection");
(0, vitest_1.describe)('Component Tests', () => {
    let connection;
    (0, vitest_1.beforeAll)(async () => {
        connection = await (0, connection_1.newConnection)();
    }, connection_1.CONNECTION_TIMEOUT);
    (0, vitest_1.afterAll)(async () => {
        await (0, connection_1.disposeConnection)(connection);
    });
    (0, vitest_1.it)('Get new libl', async () => {
        const component = connection.getComponent(getNewLibl_1.GetNewLibl.ID);
        if (component) {
            const newLibl = await component.getLibraryListFromCommand(connection, `CHGLIBL CURLIB(SYSTOOLS)`);
            (0, vitest_1.expect)(newLibl?.currentLibrary).toBe(`SYSTOOLS`);
        }
        else {
            throw new Error(`Component not installed`);
        }
    });
    (0, vitest_1.it)('Check getMemberInfo', async () => {
        const component = connection?.getComponent(getMemberInfo_1.GetMemberInfo.ID);
        (0, vitest_1.expect)(component).toBeTruthy();
        const memberInfoA = await component.getMemberInfo(connection, `QSYSINC`, `H`, `MATH`);
        (0, vitest_1.expect)(memberInfoA).toBeTruthy();
        (0, vitest_1.expect)(memberInfoA?.library).toBe(`QSYSINC`);
        (0, vitest_1.expect)(memberInfoA?.file).toBe(`H`);
        (0, vitest_1.expect)(memberInfoA?.name).toBe(`MATH`);
        (0, vitest_1.expect)(memberInfoA?.extension).toBe(`C`);
        (0, vitest_1.expect)(memberInfoA?.text).toBe(`STANDARD HEADER FILE MATH`);
        const memberInfoB = await component.getMemberInfo(connection, `QSYSINC`, `H`, `MEMORY`);
        (0, vitest_1.expect)(memberInfoB).toBeTruthy();
        (0, vitest_1.expect)(memberInfoB?.library).toBe(`QSYSINC`);
        (0, vitest_1.expect)(memberInfoB?.file).toBe(`H`);
        (0, vitest_1.expect)(memberInfoB?.name).toBe(`MEMORY`);
        (0, vitest_1.expect)(memberInfoB?.extension).toBe(`CPP`);
        (0, vitest_1.expect)(memberInfoB?.text).toBe(`C++ HEADER`);
        try {
            await component.getMemberInfo(connection, `QSYSINC`, `H`, `OH_NONO`);
        }
        catch (error) {
            (0, vitest_1.expect)(error).toBeInstanceOf(Tools_1.Tools.SqlError);
            (0, vitest_1.expect)(error.sqlstate).toBe("38501");
        }
        // Check getMemberInfo for empty member.
        const config = connection.getConfig();
        const tempLib = config.tempLibrary, tempSPF = `O_ABC`.concat(connection.variantChars.local), tempMbr = `O_ABC`.concat(connection.variantChars.local);
        const result = await connection.runCommand({
            command: `CRTSRCPF ${tempLib}/${tempSPF} MBR(${tempMbr})`,
            environment: 'ile'
        });
        if (result.code === 0) {
            try {
                const memberInfoC = await component.getMemberInfo(connection, tempLib, tempSPF, tempMbr);
                (0, vitest_1.expect)(memberInfoC).toBeTruthy();
                (0, vitest_1.expect)(memberInfoC?.library).toBe(tempLib);
                (0, vitest_1.expect)(memberInfoC?.file).toBe(tempSPF);
                (0, vitest_1.expect)(memberInfoC?.name).toBe(tempMbr);
                (0, vitest_1.expect)(memberInfoC?.created).toBeTypeOf('object');
                (0, vitest_1.expect)(memberInfoC?.changed).toBeTypeOf('object');
            }
            finally {
                // Cleanup...
                await connection.runCommand({
                    command: `DLTF ${tempLib}/${tempSPF}`,
                    environment: 'ile'
                });
            }
        }
    });
    (0, vitest_1.it)('Can get component no matter the state', async () => {
        const componentA = connection.getComponent(customCli_1.CustomCLI.ID, { ignoreState: true });
        (0, vitest_1.expect)(componentA).toBeDefined();
        (0, vitest_1.expect)(componentA?.getIdentification().version).toBe(1);
        (0, vitest_1.expect)(componentA?.getIdentification().userManaged).toBe(true);
    });
    (0, vitest_1.it)('Can install a component', async () => {
        const manager = connection.getComponentManager();
        try {
            await manager.uninstallComponent(customCli_1.CustomCLI.ID);
        }
        catch (e) {
            console.log(`Component not installed, skipping uninstall.`);
        }
        const requiredCheckA = await manager.getRemoteState(customCli_1.CustomCLI.ID);
        (0, vitest_1.expect)(requiredCheckA).toBeDefined();
        (0, vitest_1.expect)(requiredCheckA).toBe(`NotInstalled`);
        const allComponents = manager.getComponentStates();
        (0, vitest_1.expect)(allComponents.length > 1).toBeTruthy();
        const state = allComponents.some(c => c.id.name === customCli_1.CustomCLI.ID && c.state === `NotInstalled`);
        (0, vitest_1.expect)(state).toBeTruthy();
        const version1 = connection.getComponent(customCli_1.CustomCLI.ID);
        (0, vitest_1.expect)(version1).toBeUndefined();
        const resultA = await manager.installComponent(customCli_1.CustomCLI.ID);
        (0, vitest_1.expect)(resultA.state).toBe(`Installed`);
        const requiredCheckB = await manager.getRemoteState(customCli_1.CustomCLI.ID);
        (0, vitest_1.expect)(requiredCheckB).toBeTruthy();
        (0, vitest_1.expect)(requiredCheckB).toBe(`Installed`);
        try {
            await manager.installComponent(customCli_1.CustomCLI.ID);
            vitest_1.expect.fail(`Should not be able to install the same component twice.`);
        }
        catch (e) {
            (0, vitest_1.expect)(e).toBeInstanceOf(Error);
        }
    });
});
//# sourceMappingURL=components.test.js.map