"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteStoredPassword = exports.setStoredPassword = exports.getStoredPassword = void 0;
const getPasswordKey = (connectionName) => `${connectionName}_password`;
function getStoredPassword(context, connectionName) {
    const connectionKey = getPasswordKey(connectionName);
    return context.secrets.get(connectionKey);
}
exports.getStoredPassword = getStoredPassword;
function setStoredPassword(context, connectionName, password) {
    const connectionKey = getPasswordKey(connectionName);
    return context.secrets.store(connectionKey, password);
}
exports.setStoredPassword = setStoredPassword;
function deleteStoredPassword(context, connectionName) {
    const connectionKey = getPasswordKey(connectionName);
    return context.secrets.delete(connectionKey);
}
exports.deleteStoredPassword = deleteStoredPassword;
//# sourceMappingURL=passwords.js.map