"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Variables = void 0;
class Variables extends Map {
    constructor(connection, variables) {
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
                this.set(`&${variable.name.toUpperCase()}`, variable.value || '');
            }
        }
    }
    set(key, value) {
        super.set(key, value);
        this.expandVariables();
        return this;
    }
    expandVariables() {
        for (const [key, value] of this.entries()) {
            super.set(key, this.expand(value, [key]));
        }
    }
    expand(input, keysToOmit = []) {
        for (const [key, value] of this.entries()) {
            if (!keysToOmit.includes(key)) {
                input = input.replace(new RegExp(key, `g`), value);
            }
        }
        return input;
    }
    toPaseVariables() {
        const variables = {};
        for (const [key, value] of this.entries()) {
            const cleanKey = key.startsWith('&') ? key.substring(1) : key;
            if ((/^[a-z_]\w*$/i).test(cleanKey)) {
                variables[cleanKey] = value;
            }
        }
        return variables;
    }
}
exports.Variables = Variables;
//# sourceMappingURL=variables.js.map