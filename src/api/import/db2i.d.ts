export interface Db2i {
  sqlJob: (options?: JDBCOptions) => SQLJob;
}

export interface JDBCOptions {}

export declare enum JobStatus {
    NotStarted = "notStarted",
    Ready = "ready",
    Busy = "busy",
    Ended = "ended"
}
export declare enum ExplainType {
    Run = 0,
    DoNotRun = 1
}

export interface ServerResponse {
    id: string;
    success: boolean;
    error?: string;
    sql_rc: number;
    sql_state: string;
}
export interface ConnectionResult extends ServerResponse {
    job: string;
}
export interface VersionCheckResult extends ServerResponse {
    build_date: string;
    version: string;
}
export interface ExplainResults<T> extends QueryResult<T> {
    vemetadata: QueryMetaData;
    vedata: any;
}
export interface GetTraceDataResult extends ServerResponse {
    tracedata: string;
}
export declare enum ServerTraceLevel {
    OFF = "OFF",
    ON = "ON",
    ERRORS = "ERRORS",
    DATASTREAM = "DATASTREAM"
}
export declare enum ServerTraceDest {
    FILE = "FILE",
    IN_MEM = "IN_MEM"
}
export interface QueryOptions {
    isTerseResults?: boolean;
    isClCommand?: boolean;
    parameters?: any[];
    autoClose?: boolean;
}
export interface SetConfigResult extends ServerResponse {
    tracedest: ServerTraceDest;
    tracelevel: ServerTraceLevel;
}
export interface QueryResult<T> extends ServerResponse {
    metadata: QueryMetaData;
    is_done: boolean;
    has_results: boolean;
    update_count: number;
    data: T[];
}
export interface JobLogEntry {
    MESSAGE_ID: string;
    SEVERITY: string;
    MESSAGE_TIMESTAMP: string;
    FROM_LIBRARY: string;
    FROM_PROGRAM: string;
    MESSAGE_TYPE: string;
    MESSAGE_TEXT: string;
    MESSAGE_SECOND_LEVEL_TEXT: string;
}
export interface CLCommandResult extends ServerResponse {
    joblog: JobLogEntry[];
}
export interface QueryMetaData {
    column_count: number;
    columns: ColumnMetaData[];
    job: string;
}
export interface ColumnMetaData {
    display_size: number;
    label: string;
    name: string;
    type: string;
}
export declare type Rows = {
    [column: string]: string | number | boolean;
}[];
export interface JDBCOptions {
    "naming"?: "sql" | "system";
    "date format"?: "mdy" | "dmy" | "ymd" | "usa" | "iso" | "eur" | "jis" | "julian";
    "date separator"?: "/" | "-" | "." | "," | "b";
    "decimal separator"?: "." | ",";
    "time format"?: "hms" | "usa" | "iso" | "eur" | "jis";
    "time separator"?: ":" | "." | "," | "b";
    "full open"?: boolean;
    "access"?: "all" | "read call" | "read only";
    "autocommit exception"?: boolean;
    "bidi string type"?: "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11";
    "bidi implicit reordering"?: boolean;
    "bidi numeric ordering"?: boolean;
    "data truncation"?: boolean;
    "driver"?: "toolbox" | "native";
    "errors"?: "full" | "basic";
    "extended metadata"?: boolean;
    "hold input locators"?: boolean;
    "hold statements"?: boolean;
    "ignore warnings"?: string;
    "keep alive"?: boolean;
    "key ring name"?: string;
    "key ring password"?: string;
    "metadata source"?: "0" | "1";
    "proxy server"?: string;
    "remarks"?: "sql" | "system";
    "secondary URL"?: string;
    "secure"?: boolean;
    "server trace"?: "0" | "2" | "4" | "8" | "16" | "32" | "64";
    "thread used"?: boolean;
    "toolbox trace"?: "" | "none" | "datastream" | "diagnostic" | "error" | "warning" | "conversion" | "jdbc" | "pcml" | "all" | "proxy" | "thread" | "information";
    "trace"?: boolean;
    "translate binary"?: boolean;
    "translate boolean"?: boolean;
    "libraries"?: string[];
    "auto commit"?: boolean;
    "concurrent access resolution"?: "1" | "2" | "3";
    "cursor hold"?: boolean;
    "cursor sensitivity"?: "asensitive" | "insensitive" | "sensitive";
    "database name"?: string;
    "decfloat rounding mode"?: "half even" | "half up" | "down" | "ceiling" | "floor" | "up" | "half down";
    "maximum precision"?: "31" | "63";
    "maximum scale"?: string;
    "minimum divide scale"?: "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
    "package ccsid"?: "1200" | "13488" | "system";
    "transaction isolation"?: "none" | "read uncommitted" | "read committed" | "repeatable read" | "serializable";
    "translate hex"?: "character" | "binary";
    "true autocommit"?: boolean;
    "XA loosely coupled support"?: "0" | "1";
    "big decimal"?: boolean;
    "block criteria"?: "0" | "1" | "2";
    "block size"?: "0" | "8" | "16" | "32" | "64" | "128" | "256" | "512";
    "data compression"?: boolean;
    "extended dynamic"?: boolean;
    "lazy close"?: boolean;
    "lob threshold"?: string;
    "maximum blocked input rows"?: string;
    "package"?: string;
    "package add"?: boolean;
    "package cache"?: boolean;
    "package criteria"?: "default" | "select";
    "package error"?: "exception" | "warning" | "none";
    "package library"?: string;
    "prefetch"?: boolean;
    "qaqqinilib"?: string;
    "query optimize goal"?: "0" | "1" | "2";
    "query timeout mechanism"?: "qqrytimlmt" | "cancel";
    "query storage limit"?: string;
    "receive buffer size"?: string;
    "send buffer size"?: string;
    "vairiable field compression"?: boolean;
    "sort"?: "hex" | "language" | "table";
    "sort language"?: string;
    "sort table"?: string;
    "sort weight"?: "shared" | "unique";
}


export declare enum TransactionEndType {
    COMMIT = 0,
    ROLLBACK = 1
}
export declare class SQLJob {
    options: JDBCOptions;
    private static uniqueIdCounter;
    private channel;
    private responseEmitter;
    private status;
    private traceFile;
    private isTracingChannelData;
    private uniqueId;
    id: string | undefined;
    static getNewUniqueId(prefix?: string): string;
    static useExec(): Promise<boolean>;
    constructor(options?: JDBCOptions);
    private getChannel;
    send(content: string): Promise<string>;
    getStatus(): JobStatus;
    connect(): Promise<ConnectionResult>;
    query<T>(sql: string, opts?: QueryOptions): Query<T>;
    requestCancel(): Promise<boolean>;
    getVersion(): Promise<VersionCheckResult>;
    explain(statement: string, type?: ExplainType): Promise<ExplainResults<any>>;
    getTraceFilePath(): string | undefined;
    getTraceData(): Promise<GetTraceDataResult>;
    setTraceConfig(dest: ServerTraceDest, level: ServerTraceLevel): Promise<SetConfigResult>;
    clcommand(cmd: string): Query<any>;
    getJobLog(): Promise<QueryResult<JobLogEntry>>;
    underCommitControl(): boolean;
    getPendingTransactions(): Promise<number>;
    endTransaction(type: TransactionEndType): Promise<QueryResult<JobLogEntry>>;
    getUniqueId(): string;
    close(): Promise<void>;
    dispose(): void;
}

export declare enum QueryState {
    NOT_YET_RUN = 1,
    RUN_MORE_DATA_AVAILABLE = 2,
    RUN_DONE = 3,
    ERROR = 4
}
export declare class Query<T> {
    private job;
    private static globalQueryList;
    private correlationId;
    private sql;
    private isPrepared;
    private parameters;
    private rowsToFetch;
    private isCLCommand;
    private state;
    private isTerseResults;
    shouldAutoClose: boolean;
    constructor(job: SQLJob, query: string, opts?: QueryOptions);
    static byId(id: string): Query<any>;
    static getOpenIds(forJob?: SQLJob): string[];
    static cleanup(): Promise<void>;
    run(rowsToFetch?: number): Promise<QueryResult<T>>;
    fetchMore(rowsToFetch?: number): Promise<QueryResult<T>>;
    close(): Promise<string>;
    getHostJob(): SQLJob;
    getId(): string;
    getState(): QueryState;
}
