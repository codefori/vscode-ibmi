
module.exports = {
  getAliasName: (library, sourceFile, member) => {
    return `${library}_${sourceFile}_${member}`.replace(/\./g, `_`)
  },

  /** @type {{[path: string]: string[]}} */
  allSourceDates: {},
  /** @type {{[path: string]: number}} */
  recordLengths: {},
};