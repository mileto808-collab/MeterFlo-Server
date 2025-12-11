import mysql from "mysql2/promise";
import mssql from "mssql";
import { Pool as PgPool } from "pg";
import mariadb from "mariadb";
import type { DatabaseType, ExternalDatabaseConfig } from "@shared/schema";

interface ConnectionResult {
  success: boolean;
  message: string;
  error?: string;
}

interface QueryResult {
  success: boolean;
  data?: Record<string, unknown>[];
  columns?: string[];
  rowCount?: number;
  error?: string;
}

type DatabaseConnection = 
  | mysql.Connection 
  | mssql.ConnectionPool 
  | PgPool 
  | mariadb.Connection;

export class ExternalDatabaseService {
  private static getDefaultPort(databaseType: DatabaseType): number {
    const ports: Record<DatabaseType, number> = {
      postgresql: 5432,
      mysql: 3306,
      mssql: 1433,
      oracle: 1521,
      sqlite: 0,
      mariadb: 3306,
    };
    return ports[databaseType] || 5432;
  }

  static async testConnection(config: Partial<ExternalDatabaseConfig>): Promise<ConnectionResult> {
    const { databaseType, host, port, databaseName, username, password, sslEnabled } = config;

    if (!databaseType || !host || !databaseName || !username || !password) {
      return { success: false, message: "Missing required connection parameters" };
    }

    try {
      const ssl = sslEnabled ?? false;
      switch (databaseType as DatabaseType) {
        case "postgresql":
          return await this.testPostgresConnection(host, port || 5432, databaseName, username, password, ssl);
        case "mysql":
          return await this.testMySQLConnection(host, port || 3306, databaseName, username, password, ssl);
        case "mssql":
          return await this.testMSSQLConnection(host, port || 1433, databaseName, username, password, ssl);
        case "mariadb":
          return await this.testMariaDBConnection(host, port || 3306, databaseName, username, password, ssl);
        case "oracle":
          return { success: false, message: "Oracle database connection requires additional configuration. Please contact support." };
        case "sqlite":
          return { success: false, message: "SQLite is a file-based database and cannot be accessed remotely." };
        default:
          return { success: false, message: `Unsupported database type: ${databaseType}` };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return { success: false, message: "Connection failed", error: errorMessage };
    }
  }

  private static async testPostgresConnection(
    host: string,
    port: number,
    database: string,
    user: string,
    password: string,
    ssl?: boolean
  ): Promise<ConnectionResult> {
    const pool = new PgPool({
      host,
      port,
      database,
      user,
      password,
      ssl: ssl ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10000,
    });

    try {
      const client = await pool.connect();
      await client.query("SELECT 1");
      client.release();
      await pool.end();
      return { success: true, message: "PostgreSQL connection successful" };
    } catch (error: unknown) {
      await pool.end();
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: "PostgreSQL connection failed", error: errorMessage };
    }
  }

  private static async testMySQLConnection(
    host: string,
    port: number,
    database: string,
    user: string,
    password: string,
    ssl?: boolean
  ): Promise<ConnectionResult> {
    try {
      const connection = await mysql.createConnection({
        host,
        port,
        database,
        user,
        password,
        ssl: ssl ? { rejectUnauthorized: false } : undefined,
        connectTimeout: 10000,
      });
      await connection.query("SELECT 1");
      await connection.end();
      return { success: true, message: "MySQL connection successful" };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: "MySQL connection failed", error: errorMessage };
    }
  }

  private static async testMSSQLConnection(
    host: string,
    port: number,
    database: string,
    user: string,
    password: string,
    ssl?: boolean
  ): Promise<ConnectionResult> {
    const config: mssql.config = {
      server: host,
      port,
      database,
      user,
      password,
      options: {
        encrypt: ssl || false,
        trustServerCertificate: true,
      },
      connectionTimeout: 10000,
    };

    try {
      const pool = await mssql.connect(config);
      await pool.query("SELECT 1");
      await pool.close();
      return { success: true, message: "Microsoft SQL Server connection successful" };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: "Microsoft SQL Server connection failed", error: errorMessage };
    }
  }

  private static async testMariaDBConnection(
    host: string,
    port: number,
    database: string,
    user: string,
    password: string,
    ssl?: boolean
  ): Promise<ConnectionResult> {
    try {
      const connection = await mariadb.createConnection({
        host,
        port,
        database,
        user,
        password,
        ssl: ssl ? { rejectUnauthorized: false } : false,
        connectTimeout: 10000,
      });
      await connection.query("SELECT 1");
      await connection.end();
      return { success: true, message: "MariaDB connection successful" };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: "MariaDB connection failed", error: errorMessage };
    }
  }

  static async executeQuery(config: ExternalDatabaseConfig, query: string, limit?: number): Promise<QueryResult> {
    const { databaseType, host, port, databaseName, username, password, sslEnabled } = config;
    
    const limitedQuery = limit ? this.addLimitToQuery(query, databaseType as DatabaseType, limit) : query;

    try {
      switch (databaseType as DatabaseType) {
        case "postgresql":
          return await this.executePostgresQuery(host, port, databaseName, username, password, sslEnabled || false, limitedQuery);
        case "mysql":
          return await this.executeMySQLQuery(host, port, databaseName, username, password, sslEnabled || false, limitedQuery);
        case "mssql":
          return await this.executeMSSQLQuery(host, port, databaseName, username, password, sslEnabled || false, limitedQuery);
        case "mariadb":
          return await this.executeMariaDBQuery(host, port, databaseName, username, password, sslEnabled || false, limitedQuery);
        default:
          return { success: false, error: `Unsupported database type: ${databaseType}` };
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      return { success: false, error: errorMessage };
    }
  }

  private static addLimitToQuery(query: string, dbType: DatabaseType, limit: number): string {
    const trimmedQuery = query.trim().replace(/;$/, "");
    
    switch (dbType) {
      case "mssql":
        if (!trimmedQuery.toLowerCase().includes("top")) {
          return trimmedQuery.replace(/^select/i, `SELECT TOP ${limit}`);
        }
        return trimmedQuery;
      case "oracle":
        return `SELECT * FROM (${trimmedQuery}) WHERE ROWNUM <= ${limit}`;
      default:
        if (!trimmedQuery.toLowerCase().includes("limit")) {
          return `${trimmedQuery} LIMIT ${limit}`;
        }
        return trimmedQuery;
    }
  }

  private static async executePostgresQuery(
    host: string,
    port: number,
    database: string,
    user: string,
    password: string,
    ssl: boolean,
    query: string
  ): Promise<QueryResult> {
    const pool = new PgPool({
      host,
      port,
      database,
      user,
      password,
      ssl: ssl ? { rejectUnauthorized: false } : false,
    });

    try {
      const result = await pool.query(query);
      await pool.end();
      
      const columns = result.fields?.map(f => f.name) || [];
      return {
        success: true,
        data: result.rows,
        columns,
        rowCount: result.rowCount || 0,
      };
    } catch (error: unknown) {
      await pool.end();
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: errorMessage };
    }
  }

  private static async executeMySQLQuery(
    host: string,
    port: number,
    database: string,
    user: string,
    password: string,
    ssl: boolean,
    query: string
  ): Promise<QueryResult> {
    try {
      const connection = await mysql.createConnection({
        host,
        port,
        database,
        user,
        password,
        ssl: ssl ? { rejectUnauthorized: false } : undefined,
      });
      
      const [rows, fields] = await connection.query(query);
      await connection.end();
      
      const data = Array.isArray(rows) ? rows as Record<string, unknown>[] : [];
      const columns = Array.isArray(fields) ? fields.map(f => f.name) : [];
      
      return {
        success: true,
        data,
        columns,
        rowCount: data.length,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: errorMessage };
    }
  }

  private static async executeMSSQLQuery(
    host: string,
    port: number,
    database: string,
    user: string,
    password: string,
    ssl: boolean,
    query: string
  ): Promise<QueryResult> {
    const config: mssql.config = {
      server: host,
      port,
      database,
      user,
      password,
      options: {
        encrypt: ssl,
        trustServerCertificate: true,
      },
    };

    try {
      const pool = await mssql.connect(config);
      const result = await pool.query(query);
      await pool.close();
      
      const data = result.recordset || [];
      const columns = data.length > 0 ? Object.keys(data[0]) : [];
      
      return {
        success: true,
        data,
        columns,
        rowCount: data.length,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: errorMessage };
    }
  }

  private static async executeMariaDBQuery(
    host: string,
    port: number,
    database: string,
    user: string,
    password: string,
    ssl: boolean,
    query: string
  ): Promise<QueryResult> {
    try {
      const connection = await mariadb.createConnection({
        host,
        port,
        database,
        user,
        password,
        ssl: ssl ? { rejectUnauthorized: false } : false,
      });
      
      const result = await connection.query(query);
      await connection.end();
      
      const data = Array.isArray(result) ? result : [];
      const columns = data.length > 0 ? Object.keys(data[0]).filter(k => k !== "meta") : [];
      
      return {
        success: true,
        data: data.map((row: Record<string, unknown>) => {
          const cleanRow: Record<string, unknown> = {};
          columns.forEach(col => { cleanRow[col] = row[col]; });
          return cleanRow;
        }),
        columns,
        rowCount: data.length,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, error: errorMessage };
    }
  }

  static getWorkOrderFieldMappings(): { key: string; label: string; required: boolean }[] {
    return [
      { key: "customerWoId", label: "Work Order ID", required: true },
      { key: "customerId", label: "Customer ID", required: true },
      { key: "customerName", label: "Customer Name", required: true },
      { key: "address", label: "Address", required: true },
      { key: "city", label: "City", required: false },
      { key: "state", label: "State", required: false },
      { key: "zip", label: "ZIP Code", required: false },
      { key: "phone", label: "Phone", required: false },
      { key: "email", label: "Email", required: false },
      { key: "route", label: "Route", required: false },
      { key: "zone", label: "Zone", required: false },
      { key: "serviceType", label: "Service Type (Water/Electric/Gas)", required: true },
      { key: "oldMeterId", label: "Old Meter ID", required: false },
      { key: "oldMeterReading", label: "Old Meter Reading", required: false },
      { key: "newMeterId", label: "New Meter ID", required: false },
      { key: "newMeterReading", label: "New Meter Reading", required: false },
      { key: "oldGps", label: "Old GPS Coordinates", required: false },
      { key: "newGps", label: "New GPS Coordinates", required: false },
      { key: "priority", label: "Priority (low/medium/high/urgent)", required: false },
      { key: "notes", label: "Notes", required: false },
    ];
  }
}
