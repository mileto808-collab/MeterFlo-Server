import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from "node:crypto";

const LOG_DIR = process.env.LOG_DIR || './logs';
const ERROR_LOG = path.join(LOG_DIR, 'error.log');
let MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB before rotation

export function setLogRotationMiB(value: number) {
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error("Invalid rotation size");
  MAX_LOG_SIZE = value * 1024 * 1024;
}

// Ensure log directory exists
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

// Rotate log file if it exceeds max size
function rotateLogIfNeeded(logPath: string) {
  try {
    if (fs.existsSync(logPath)) {
      const stats = fs.statSync(logPath);
      if (stats.size > MAX_LOG_SIZE) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedPath = logPath.replace('.log', `-${timestamp}-${randomBytes(4).toString("hex")}.log`);
        fs.renameSync(logPath, rotatedPath);
      }
    }
  } catch (err) {
    console.error('Log rotation failed:', err);
  }
}

// Format log entry with timestamp and context
function formatLogEntry(level: string, message: string, context?: Record<string, any>): string {
  const timestamp = new Date().toISOString();
  const contextStr = context ? `\n  Context: ${JSON.stringify(context, null, 2)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${contextStr}\n`;
}

// Write to log file
function writeToLog(logPath: string, entry: string) {
  try {
    ensureLogDir();
    if (fs.existsSync(logPath)) {
      const stat = fs.lstatSync(logPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error("Unsafe error-log file");
    }
    rotateLogIfNeeded(logPath);
    const fd = fs.openSync(logPath, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0), 0o600);
    try { fs.writeSync(fd, entry); } finally { fs.closeSync(fd); }
  } catch {
    console.error("Error log write failed; check LOG_DIR permissions and file safety.");
  }
}

// Logger interface
export const logger = {
  info(message: string, context?: Record<string, any>) {
    const entry = formatLogEntry('INFO', message, context);
    console.log(entry.trim());
  },

  warn(message: string, context?: Record<string, any>) {
    const entry = formatLogEntry('WARN', message, context);
    console.warn(entry.trim());
  },

  error(message: string, error?: Error | unknown, context?: Record<string, any>) {
    const errorDetails = error instanceof Error 
      ? { name: error.name, message: error.message, stack: error.stack }
      : error ? { raw: String(error) } : undefined;
    
    const fullContext = { ...context, error: errorDetails };
    const entry = formatLogEntry('ERROR', message, fullContext);
    
    console.error(entry.trim());
    writeToLog(ERROR_LOG, entry);
  },

  debug(message: string, context?: Record<string, any>) {
    if (process.env.NODE_ENV === 'development') {
      const entry = formatLogEntry('DEBUG', message, context);
      console.log(entry.trim());
    }
  },

  // Log database constraint violations with helpful context
  dbError(operation: string, error: Error | unknown, context?: Record<string, any>) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Check for unique constraint violations
    if (errorMessage.includes('unique constraint') || errorMessage.includes('duplicate key')) {
      this.error(`Database constraint violation during ${operation}`, error, {
        ...context,
        suggestion: 'Check for duplicate system/module IDs in the data'
      });
    } else {
      this.error(`Database error during ${operation}`, error, context);
    }
  }
};

// Log configuration on startup
export function initializeLogger() {
  ensureLogDir();
  logger.info('Logger initialized', {
    logDirectory: LOG_DIR,
    errorLog: ERROR_LOG,
    environment: process.env.NODE_ENV || 'development'
  });
}
