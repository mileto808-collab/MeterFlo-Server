declare module "oracledb" {
  interface OracleResult {
    rows?: unknown[];
    metaData?: Array<{ name: string }>;
  }

  interface OracleConnection {
    execute(query: string, binds?: unknown[], options?: { outFormat?: number | string }): Promise<OracleResult>;
    close(): Promise<void>;
  }

  const oracledb: {
    OUT_FORMAT_OBJECT: number;
    getConnection(options: {
      user: string;
      password: string;
      connectString: string;
    }): Promise<OracleConnection>;
  };

  export default oracledb;
}
