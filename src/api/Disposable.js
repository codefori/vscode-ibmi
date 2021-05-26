const vscode = require(`vscode`);

/**
 * Attach an ID to a Disposable
 * @param {string} id 
 * @param {vscode.Disposable} disposable 
 */
module.exports = (id, disposable) => {
  //@ts-ignore
  disposable.id = id;
  return disposable;
}