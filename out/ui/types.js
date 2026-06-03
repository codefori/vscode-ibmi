"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserItem = void 0;
const vscode_1 = require("vscode");
class BrowserItem extends vscode_1.TreeItem {
    params;
    constructor(label, params) {
        super(label, params?.state);
        this.params = params;
        this.iconPath = params?.icon ? new vscode_1.ThemeIcon(params.icon, params.color ? new vscode_1.ThemeColor(params.color) : undefined) : undefined;
    }
    get parent() {
        return this.params?.parent;
    }
}
exports.BrowserItem = BrowserItem;
//# sourceMappingURL=types.js.map