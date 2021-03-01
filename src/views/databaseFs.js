

var instance = require('../Instance');

class Database {

  /**
   * @param {string} schema 
   * @returns {Promise<Table[]>}
   */
  static async getObjects(schema) {
    const content = instance.getContent();

    schema = schema.toUpperCase();

    const [tablesResult, columnsResult] = await Promise.all([
      content.runSQL(`select TABLE_NAME, TABLE_TYPE, TABLE_TEXT, BASE_TABLE_SCHEMA, BASE_TABLE_NAME from QSYS2.SYSTABLES where TABLE_SCHEMA = '${schema}'`),
      content.runSQL(`select * from QSYS2.SYSCOLUMNS where TABLE_SCHEMA = '${schema}' order by ORDINAL_POSITION asc`)
    ]);

    /** @type {Table[]} */
    let tables = [];

    tables = tablesResult.map(row => new Table(row));

    let currentColumns;
    for (const table of tables) {
      currentColumns = columnsResult.filter(row => row.TABLE_NAME === table.name);
      table.columns.push(...currentColumns.map(column => new Column(column)));
    }

    return tables;
  }
}

const TABLE_TYPES = {
  A: 'Alias',
  L: 'Logical file',
  M: 'Materialized query table',
  P: 'Physical file',
  T: 'Table',
  V: 'View'
}

class Table {
  constructor(row) {
    this.name = row.TABLE_NAME;
    this._type = row.TABLE_TYPE;
    this.type = TABLE_TYPES[row.TABLE_TYPE];
    this.text = row.TABLE_TEXT;

    if (this._type === 'A') {
      //Is ALIAS

      this.base = `${row.BASE_TABLE_SCHEMA}/${row.BASE_TABLE_NAME}`;
    }

    /** @type {Column[]} */
    this.columns = [];    
  }
}

class Column {
  constructor(row) {
    this.name = row.COLUMN_NAME;
    this.table = row.TABLE_NAME;
    this.schema = row.TABLE_SCHEMA;

    this.type = row.DATA_TYPE;
    this.length = row.LENGTH;
    this.scale = row.NUMERIC_SCALE;
    this.precision = row.NUMERIC_PRECISION;

    this.nullable = row.IS_NULLABLE;
    this.default = row.COLUMN_DEFAULT;
    this.identity = (row.IS_IDENTITY === 'YES');

    this.heading = row.COLUMN_HEADING;
    this.comment = row.LONG_COMMENT;
  }
}

module.exports = {Database, TABLE_TYPES, Table, Column};