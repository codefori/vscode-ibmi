"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageSuite = void 0;
const assert_1 = __importDefault(require("assert"));
const vscode_1 = __importDefault(require("vscode"));
const instantiate_1 = require("../instantiate");
exports.StorageSuite = {
    name: `Extension storage tests`,
    tests: [
        {
            name: "Authorized extensions", test: async () => {
                const storage = instantiate_1.instance.getStorage();
                if (storage) {
                    const extension = vscode_1.default.extensions.getExtension("halcyontechltd.code-for-ibmi");
                    try {
                        let auth = storage.getExtensionAuthorisation(extension.id);
                        assert_1.default.strictEqual(undefined, auth, "Extension is already authorized");
                        storage.grantExtensionAuthorisation(extension.id, extension.packageJSON.displayName || extension.id);
                        auth = storage.getExtensionAuthorisation(extension.id);
                        assert_1.default.ok(auth, "Authorisation not found");
                        assert_1.default.strictEqual(new Date(auth.since).toDateString(), new Date().toDateString(), "Access date must be today");
                        const lastAccess = auth.lastAccess;
                        await new Promise(r => setTimeout(r, 100)); //Wait a bit
                        auth = storage.getExtensionAuthorisation(extension.id);
                        assert_1.default.ok(auth, "Authorisation not found");
                        assert_1.default.notStrictEqual(lastAccess, auth.lastAccess, "Last access did not change");
                    }
                    finally {
                        const auth = storage.getExtensionAuthorisation(extension.id);
                        if (auth) {
                            storage.revokeExtensionAuthorisation(auth);
                        }
                    }
                }
                else {
                    throw Error("Cannot run test: no storage");
                }
            }
        }
    ]
};
//# sourceMappingURL=storage.js.map