"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const variables_1 = require("../../variables");
const connection_1 = require("../connection");
(0, vitest_1.describe)(`variables tests`, { concurrent: true }, () => {
    const variables = new variables_1.Variables();
    (0, vitest_1.beforeAll)(async () => {
        (0, vitest_1.expect)(variables.size).toBe(0);
        variables.set("&FOO", "bar")
            .set("&FOOTWO", "bartwo")
            .set("&FOOTHREE", "barthree")
            .set("{FOOFOUR}", "barfour");
    }),
        (0, vitest_1.it)('Variables get', () => {
            (0, vitest_1.expect)(variables.size).toBe(4);
            (0, vitest_1.expect)(variables.get("&FOO")).toBe("bar");
            (0, vitest_1.expect)(variables.get("&FOOTWO")).toBe("bartwo");
            (0, vitest_1.expect)(variables.get("&FOOTHREE")).toBe("barthree");
            (0, vitest_1.expect)(variables.get("{FOOFOUR}")).toBe("barfour");
            (0, vitest_1.expect)(variables.get("&FOOFIGHTERS")).toBeUndefined();
        }),
        (0, vitest_1.it)('Variables copy', () => {
            const variablesCopy = new variables_1.Variables(undefined, variables);
            (0, vitest_1.expect)(variablesCopy.size).toBe(4);
            (0, vitest_1.expect)(variablesCopy.get("&FOO")).toBe("bar");
            (0, vitest_1.expect)(variablesCopy.get("&FOOTWO")).toBe("bartwo");
            (0, vitest_1.expect)(variablesCopy.get("&FOOTHREE")).toBe("barthree");
            (0, vitest_1.expect)(variablesCopy.get("{FOOFOUR}")).toBe("barfour");
            (0, vitest_1.expect)(variablesCopy.get("&FOOFIGHTERS")).toBeUndefined();
        }),
        (0, vitest_1.it)('Variables expansion', () => {
            const vars = new variables_1.Variables();
            vars.set("&PARAMETER", "TYPE(&TYPE)");
            vars.set("&TYPE", "*PGM");
            const input = "CRTSOMETHING &PARAMETER";
            (0, vitest_1.expect)(vars.expand(input)).toBe("CRTSOMETHING TYPE(*PGM)");
        }),
        (0, vitest_1.it)('To Pase variables', () => {
            const paseVariables = variables.toPaseVariables();
            (0, vitest_1.expect)(paseVariables).toEqual({
                "FOO": "bar",
                "FOOTWO": "bartwo",
                "FOOTHREE": "barthree",
                "{FOOFOUR}": undefined
            });
        });
    (0, vitest_1.it)('Connection variables', async () => {
        const connection = await (0, connection_1.newConnection)();
        const config = connection.getConfig();
        const customVariables = config.customVariables;
        try {
            customVariables.push({ name: "CUSTOM", value: "value" }, { name: "WARCRY", value: "Fus Roh Dah!" }, { name: "EXPANDED", value: `I am &USERNAME!` });
            const connectionVariables = new variables_1.Variables(connection);
            (0, vitest_1.expect)(connectionVariables.get("&USERNAME")).toBe(connection.currentUser);
            (0, vitest_1.expect)(connectionVariables.get("{usrprf}")).toBe(connectionVariables.get("&USERNAME"));
            (0, vitest_1.expect)(connectionVariables.get("&HOST")).toBe(connection.currentHost);
            (0, vitest_1.expect)(connectionVariables.get("{host}")).toBe(connectionVariables.get("&HOST"));
            (0, vitest_1.expect)(connectionVariables.get("&HOME")).toBe(config.homeDirectory);
            (0, vitest_1.expect)(connectionVariables.get("&WORKDIR")).toBe(connectionVariables.get("&HOME"));
            (0, vitest_1.expect)(connectionVariables.get("&CUSTOM")).toBe("value");
            (0, vitest_1.expect)(connectionVariables.get("&WARCRY")).toBe("Fus Roh Dah!");
            (0, vitest_1.expect)(connectionVariables.get("&EXPANDED")).toBe(`I am ${connectionVariables.get("&USERNAME")}!`);
        }
        finally {
            customVariables.splice(0, customVariables.length);
            await (0, connection_1.disposeConnection)(connection);
        }
    });
});
//# sourceMappingURL=variables.test.js.map