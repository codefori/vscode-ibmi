"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setup = void 0;
const connection_1 = require("./connection");
async function setup(project) {
    // Pre-connects to create/refresh the configuration files.
    // When the config files exist, it makes future connections just slightly faster.
    // Mostly useful during the CI stage.
    console.log(``);
    console.log(`Connecting before tests run to create/refresh settings.`);
    const conn = await (0, connection_1.newConnection)(true);
    await (0, connection_1.disposeConnection)(conn);
    console.log(`Testing connection complete. Settings written/refreshed.`);
    console.log(``);
}
exports.setup = setup;
//# sourceMappingURL=setup.js.map