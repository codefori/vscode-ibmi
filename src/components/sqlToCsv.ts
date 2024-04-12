import IBMi from "../api/IBMi";
import { Tools } from "../api/Tools";
import { instance } from "../instantiate";
import { ComponentT, ComponentState } from "./component";
import { parse } from 'csv-parse/sync';

export class SqlToCsv extends ComponentT {
  public currentVersion: number = 2;

  async getInstalledVersion(): Promise<number> {
    const config = this.connection.config!
    const lib = config.tempLibrary!;
    const sql = `select LONG_COMMENT from qsys2.sysroutines where routine_schema = '${lib.toUpperCase()}' and routine_name = 'SQL_TO_CSV'`
    const [result] = await this.connection.runSQL(sql);
    if (result) {
      const comment = result.LONG_COMMENT as string;
      const dash = comment.indexOf('-');
      if (dash > -1) {
        const version = comment.substring(0, dash).trim();
        return parseInt(version);
      }
    }

    return 0;
  }

  async checkState(): Promise<boolean> {
    const installedVersion = await this.getInstalledVersion();

    if (installedVersion === this.currentVersion) {
      this.state = ComponentState.Installed;
      return true;
    }

    const config = this.connection.config!
    const content = instance.getContent();

    const tempSourcePath = this.connection.getTempRemote(`csvToSql.sql`)!;

    await content!.writeStreamfile(tempSourcePath, getSource(config.tempLibrary));
    const result = await this.connection.runCommand({
      command: `RUNSQLSTM SRCSTMF('${tempSourcePath}') COMMIT(*NONE) NAMING(*SQL)`,
      cwd: `/`,
      noLibList: true
    });

    if (result.code === 0) {
      this.state = ComponentState.Installed;
    } else {
      this.state = ComponentState.Error;
    }

    return this.state === ComponentState.Installed;
  }

  getState(): ComponentState {
    return this.state;
  }

  async runStatements(...statements: string[]): Promise<Tools.DB2Row[]> {
    const tempLib = this.connection.config!.tempLibrary!;
    const getCsv = this.connection.getTempRemote(Tools.makeid())!;
    const content = instance.getContent();

    statements[statements.length - 1] = `CALL ${tempLib}.SQL_TO_CSV('${statements[0].replaceAll(`'`, `''`)}', '${getCsv}')`;

    // Will throw
    await content?.runStatements(...statements);

    const csvContent = await content?.downloadStreamfile(getCsv);
    if (csvContent) {
      return parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        cast: true,
        onRecord(record) {
          for (const key of Object.keys(record)) {
            record[key] = record[key] === ` ` ? `` : record[key];
          }
          return record;
        }
      }) as Tools.DB2Row[];
    }

    throw new Error(`There was an error getting the SQL result.`);
  }
}

function getSource(library: string) {
  return `
create or replace procedure ${library}.sql_to_csv
(
    in sql_statement    clob,
    in output_file      varchar(256)
)
language sql
modifies SQL data 
  set option dbgview = *source , output=*print , commit=*none, datfmt=*iso
begin atomic

    declare sqlcode  int default 0;
    declare cols     int;
    declare colLen   int;
    declare colPrec  int;
    declare colScale int;
    declare colNo    int;
    declare colType  int;
    declare colName  varchar(256);
    declare colLabel varchar(256);
    declare colValue varchar(32000) ccsid 1208;
    declare newline     varchar(2) default ux'000A';
    declare comma    varchar (1) default '';
    declare file_content clob(16m) ccsid 1208 default '';
    
    declare c1  cursor  for stmt;
    allocate descriptor local 'original' with max 256 ;
    allocate descriptor local 'modified'  with max 256 ;
    
    Prepare stmt from sql_statement ;
    describe stmt using sql descriptor local 'original';
    describe stmt using sql descriptor local 'modified';

    -- First run the query and get our meta data 
    Open c1;
    get descriptor 'original' cols = count;
    
    -- Cast data to varchar, and build column heading 
    set comma  = '';
    set colNo = 1;
    while  colNo  <= cols  do 
        set descriptor 'modified' value colNo  
              LENGTH = 32000,
              TYPE = 12,
              DB2_CCSID = 1208;
              
        get descriptor 'original' value colNo
            colLen    = LENGTH,
            colScale  = SCALE,
            colPrec   = PRECISION,
            colName   = NAME,
            colLabel  = DB2_LABEL;

        -- REGEXP_REPLACE is throwing error in QQQSVREG
        -- set file_content = concat(file_content, comma || '"' || REGEXP_REPLACE(colLabel,'( ){2,}', ' ') || '"');
        set file_content = concat(file_content, comma || '"' || colName || '"');
        set comma = ',';
        set colNo = colNo + 1;
    end while;

    -- Now produce the rows    
    fetch c1 into sql descriptor 'modified';
    while sqlcode = 0  do 
        set file_content = concat(file_content, newline);
        set comma = '';
        set colNo = 1;
        while  colNo  <= cols  do 
            get descriptor 'original' value colNo
                colLen    = LENGTH,
                colScale  = SCALE,
                colPrec   = PRECISION,
                colName   = NAME,
                colLabel  = DB2_LABEL,
                colType   = TYPE;

            get descriptor 'modified' value colNo
                colValue = DATA;
            
            if colType in (1, 12) then -- char or varchar
                set file_content = concat(file_content, comma || '"' || replace(trim(colValue), '"' , '""')  || '"');
            elseif colType in (2 , 3) then -- decimal
                set file_content = concat(file_content, comma || trim(colValue));
            else
                set file_content = concat(file_content, comma || trim(colValue));
            end if;
            set comma = ',';
            set colNo = colNo + 1;
        end while;
        fetch c1 into sql descriptor 'modified';
    end while;
    
    close c1; 
    deallocate descriptor local 'modified';
    deallocate descriptor local 'original';

    call qsys2.ifs_write_utf8(output_file, file_content, overwrite => 'REPLACE', end_of_line => 'LF');
end;

comment on procedure ${library}.sql_to_csv is '1 - Produce a CSV file from a SQL statement';
  `
}