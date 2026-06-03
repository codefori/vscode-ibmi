"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.URI_LIST_SEPARATOR = exports.URI_LIST_MIMETYPE = exports.LIBRARY_LIST_MIMETYPE = exports.IFS_BROWSER_MIMETYPE = exports.OBJECT_BROWSER_MIMETYPE = exports.CcsidOrigin = void 0;
var CcsidOrigin;
(function (CcsidOrigin) {
    CcsidOrigin["User"] = "user";
    CcsidOrigin["System"] = "system";
})(CcsidOrigin = exports.CcsidOrigin || (exports.CcsidOrigin = {}));
;
exports.OBJECT_BROWSER_MIMETYPE = "application/vnd.code.tree.objectbrowser";
exports.IFS_BROWSER_MIMETYPE = "application/vnd.code.tree.ifsbrowser";
exports.LIBRARY_LIST_MIMETYPE = "application/vnd.code.tree.libraryListView";
exports.URI_LIST_MIMETYPE = "text/uri-list";
exports.URI_LIST_SEPARATOR = "\r\n";
__exportStar(require("./configuration/config/types"), exports);
//# sourceMappingURL=types.js.map