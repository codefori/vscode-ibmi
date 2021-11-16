const Declaration = require(`./declaration`);

module.exports = class Cache {
  /**
   * 
   * @param {{subroutines: Declaration[], procedures: Declaration[], variables: Declaration[], structs: Declaration[], constants: Declaration[]}} cache 
   */
  constructor(cache) {
    /** @type {Declaration[]} */
    this.subroutines = cache.subroutines || [];

    /** @type {Declaration[]} */
    this.procedures = cache.procedures || [];

    /** @type {Declaration[]} */
    this.variables = cache.variables || [];

    /** @type {Declaration[]} */
    this.structs = cache.structs || [];
    
    /** @type {Declaration[]} */
    this.constants = cache.constants || [];
  }
}