"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerURIHandler = void 0;
const vscode_1 = __importDefault(require("vscode"));
const instantiate_1 = require("../instantiate");
function registerURIHandler(context, ...handlers) {
    context.subscriptions.push(vscode_1.default.window.registerUriHandler({
        handleUri: (uri) => {
            handlers.filter(handler => handler.canHandle(uri.path)).forEach(handler => handler.handle(uri, instantiate_1.instance.getConnection()));
        }
    }));
}
exports.registerURIHandler = registerURIHandler;
//# sourceMappingURL=index.js.map