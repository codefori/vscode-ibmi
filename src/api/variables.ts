import IBMi from "./IBMi";

export class Variables extends Map<string, string> {
  constructor(connection?: IBMi, variables?: Record<string, string> | Map<string, string>) {
    super(variables instanceof Map ? variables : variables ? Object.entries(variables) : new Map);

    if (connection) {
      const config = connection.getConfig();
      //Add default variables
      this.set(`&BUILDLIB`, this.get(`CURLIB`) || config.currentLibrary);
      if (!this.has(`&CURLIB`)) {
        this.set(`&CURLIB`, config.currentLibrary);
      }
      if (!this.has(`\\*CURLIB`)) {
        this.set(`\\*CURLIB`, config.currentLibrary);
      }
      this.set(`&USERNAME`, connection.currentUser)
        .set(`{usrprf}`, connection.currentUser)
        .set(`&HOST`, connection.currentHost)
        .set(`{host}`, connection.currentHost)
        .set(`&HOME`, config.homeDirectory)
        .set(`&WORKDIR`, config.homeDirectory);

      for (const variable of config.customVariables) {
        this.set(`&${variable.name.toUpperCase()}`, variable.value);
      }
    }
  }

  set(key: string, value: string): this {
    super.set(key, value);
    this.expandVariables();
    return this;
  }

  private expandVariables() {
    for (const [key, value] of this.entries()) {
      super.set(key, this.expand(value, [key]));
    }
  }

  public expand(input: string, keysToOmit: string[] = []) {
    for (const [key, value] of this.entries()) {
      if (!keysToOmit.includes(key)) {
        input = input.replace(new RegExp(key, `g`), value);
      }
    }
    return input;
  }

  toPaseVariables(): Record<string, string> {
    const variables: Record<string, string> = {};
    for (const [key, value] of this.entries()) {
      const cleanKey = key.startsWith('&') ? key.substring(1) : key;
      if ((/^[a-z_]\w*$/i).test(cleanKey)) {
        variables[cleanKey] = value;
      }
    }
    return variables;
  }
}