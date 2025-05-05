import { beforeAll, describe, expect, it } from 'vitest';
import { Variables } from '../../variables';
import { CONNECTION_TIMEOUT, disposeConnection, newConnection } from '../connection';

describe(`variables tests`, { concurrent: true }, () => {
  const variables = new Variables();

  beforeAll(async () => {
    expect(variables.size).toBe(0);
    variables.set("&FOO", "bar")
      .set("&FOOTWO", "bartwo")
      .set("&FOOTHREE", "barthree");
  }, CONNECTION_TIMEOUT),

    it('Variables get', () => {
      expect(variables.size).toBe(3);
      expect(variables.get("&FOO")).toBe("bar");
      expect(variables.get("&FOOTWO")).toBe("bartwo");
      expect(variables.get("&FOOTHREE")).toBe("barthree");
      expect(variables.get("&FOOFIGHTERS")).toBeUndefined();
    }),

    it('Variables copy', () => {
      const variablesCopy = new Variables(undefined, variables);
      expect(variablesCopy.size).toBe(3);
      expect(variablesCopy.get("&FOO")).toBe("bar");
      expect(variablesCopy.get("&FOOTWO")).toBe("bartwo");
      expect(variablesCopy.get("&FOOTHREE")).toBe("barthree");
      expect(variablesCopy.get("&FOOFIGHTERS")).toBeUndefined();
    }),

    it('Variables expansion', () => {
      const vars = new Variables();
      vars.set("&PARAMETER", "TYPE(&TYPE)");
      vars.set("&TYPE", "*PGM");

      const input = "CRTSOMETHING &PARAMETER";
      expect(vars.expand(input)).toBe("CRTSOMETHING TYPE(*PGM)");

    }),

    it('To Pase variables', () => {
      const paseVariables = variables.toPaseVariables();
      expect(paseVariables["FOO"]).toBe("bar");
      expect(paseVariables["FOOTWO"]).toBe("bartwo");
      expect(paseVariables["FOOTHREE"]).toBe("barthree");
      expect(paseVariables["FOOFIGHTERS"]).toBeUndefined();
    })

  it('Connection variables', async () => {
    const connection = await newConnection();
    const config = connection.getConfig();
    const customVariables = config.customVariables
    try {
      customVariables.push(
        { name: "CUSTOM", value: "value" },
        { name: "WARCRY", value: "Fus Roh Dah!" },
        { name: "EXPANDED", value: `I am &USERNAME!` }
      );
      const connectionVariables = new Variables(connection);
      expect(connectionVariables.get("&USERNAME")).toBe(connection.currentUser);
      expect(connectionVariables.get("{usrprf}")).toBe(connectionVariables.get("&USERNAME"));
      expect(connectionVariables.get("&HOST")).toBe(connection.currentHost);
      expect(connectionVariables.get("{host}")).toBe(connectionVariables.get("&HOST"));
      expect(connectionVariables.get("&HOME")).toBe(config.homeDirectory);
      expect(connectionVariables.get("&WORKDIR")).toBe(connectionVariables.get("&HOME"));

      expect(connectionVariables.get("&CUSTOM")).toBe("value");
      expect(connectionVariables.get("&WARCRY")).toBe("Fus Roh Dah!");
      expect(connectionVariables.get("&EXPANDED")).toBe(`I am ${connectionVariables.get("&USERNAME")}!`);
    }
    finally {
      customVariables.splice(0, customVariables.length);
      disposeConnection(connection);
    }
  })
});