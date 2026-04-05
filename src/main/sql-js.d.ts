/**
 * Minimal TypeScript declarations for sql.js.
 * sql.js ships no .d.ts files, so we declare what we use here.
 */
declare module 'sql.js' {
  export type SqlValue = number | string | null | Uint8Array

  export interface Statement {
    bind(params?: SqlValue[]): boolean
    step(): boolean
    getAsObject(): Record<string, SqlValue>
    free(): boolean
    run(params?: SqlValue[]): void
  }

  export interface QueryExecResult {
    columns: string[]
    values: SqlValue[][]
  }

  export interface Database {
    run(sql: string, params?: SqlValue[]): Database
    exec(sql: string): QueryExecResult[]
    prepare(sql: string): Statement
    export(): Uint8Array
    close(): void
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database
  }

  export interface SqlJsConfig {
    locateFile?: (filename: string, prefix: string) => string
  }

  function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>
  export default initSqlJs
}
