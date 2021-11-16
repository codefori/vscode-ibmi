
module.exports = class Declaration {
  /**
   * 
   * @param {"procedure"|"subroutine"|"struct"|"subitem"|"variable"|"constant"} type 
   */
  constructor(type) {
    this.type = type;
    this.name = ``;
    this.keywords = [];
    this.description = ``;

    /** @type {{tag: string, content: string}[]} */
    this.tags = [];

    /** @type {{path: string, line: number}} */
    this.position = undefined;

    //Not used in subitem:
    /** @type {Declaration[]} */
    this.subItems = [];

    //Only used in procedure
    this.readParms = false;
  }
}