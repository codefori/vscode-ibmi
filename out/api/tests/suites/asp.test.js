"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const vitest_1 = require("vitest");
const Search_1 = require("../../Search");
const connection_1 = require("../connection");
const LIBNAME = `VSCODELIBT`;
const SPFNAME = `VSCODESPFT`;
const MBRNAME = `VSCODEMBRT`;
function checkAsps(connection) {
    const asps = connection.getAllIAsps();
    if (asps.length === 0)
        return false;
    const currentAsp = connection.getCurrentIAspName();
    if (!currentAsp)
        return false;
    return true;
}
async function ensureLibExists(connection) {
    const detail = connection.getIAspDetail(connection.getCurrentIAspName());
    const res = await connection.runCommand({ command: `CRTLIB LIB(${LIBNAME}) ASPDEV(${detail.name})` });
    if (res.code) {
        assert_1.default.strictEqual(res.code, 0, res.stderr || res.stdout);
    }
}
async function createTempRpgle(connection) {
    const content = connection.getContent();
    await connection.runCommand({
        command: `CRTSRCPF ${LIBNAME}/${SPFNAME} MBR(*NONE)`,
        environment: `ile`
    });
    await connection.runCommand({
        command: `ADDPFM FILE(${LIBNAME}/${SPFNAME}) MBR(${MBRNAME}) `,
        environment: `ile`
    });
    const baseContent = `**FREE\ndsply 'hello world';`;
    return await content?.uploadMemberContent(LIBNAME, SPFNAME, MBRNAME, baseContent);
}
(0, vitest_1.describe)(`iASP tests`, { concurrent: true }, () => {
    let connection;
    let skipAsp = false;
    (0, vitest_1.beforeAll)(async () => {
        connection = await (0, connection_1.newConnection)();
        if (checkAsps(connection)) {
            await ensureLibExists(connection);
            await createTempRpgle(connection);
        }
        else {
            console.log(`Skipping iASP tests, no ASPs found.`);
            skipAsp = true;
        }
    }, connection_1.CONNECTION_TIMEOUT);
    (0, vitest_1.afterAll)(async () => {
        await connection.runCommand({ command: `DLTLIB LIB(${LIBNAME})` });
        await (0, connection_1.disposeConnection)(connection);
    });
    (0, vitest_1.beforeEach)((t) => {
        if (skipAsp) {
            t.skip();
        }
    });
    (0, vitest_1.it)('Read members in ASP and base', async () => {
        const aspMbrContents = await connection.getContent()?.downloadMemberContent(LIBNAME, SPFNAME, MBRNAME);
        assert_1.default.ok(aspMbrContents);
    });
    (0, vitest_1.it)('can find ASP members via search', async () => {
        const searchResults = await Search_1.Search.searchMembers(connection, LIBNAME, SPFNAME, `hello world`, `*`);
        (0, vitest_1.expect)(searchResults.hits.length).toBeGreaterThan(0);
        // TODO: additional expects
    });
    (0, vitest_1.it)('can resolve member info from ASP', async () => {
        const resolved = await connection.getContent().memberResolve(MBRNAME, [
            { library: `QSYS`, name: `QSYSINC` },
            { library: LIBNAME, name: SPFNAME }
        ]);
        (0, vitest_1.expect)(resolved).toBeDefined();
        //TODO: additional expects
    });
});
//# sourceMappingURL=asp.test.js.map