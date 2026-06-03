"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnvironmentItem = void 0;
const vscode_1 = __importDefault(require("vscode"));
const types_1 = require("../../types");
class EnvironmentItem extends types_1.BrowserItem {
    async refresh() {
        await vscode_1.default.commands.executeCommand("code-for-ibmi.environment.refresh.item", this);
    }
    reveal(options) {
        return vscode_1.default.commands.executeCommand(`code-for-ibmi.environment.reveal`, this, options);
    }
}
exports.EnvironmentItem = EnvironmentItem;
//# sourceMappingURL=environmentItem.js.map