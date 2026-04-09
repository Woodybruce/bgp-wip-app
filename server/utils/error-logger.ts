import { db } from "../db";
import { sql } from "drizzle-orm";

interface ErrorLogEntry {
  level: 'error' | 'warn' | 'info' | 'debug';
  message: string;
  context?: string;
  userId?: string;
  metadata?: Record<string, any>;
  stack?: string;
}

export class ErrorLogger {
  private static async logToDatabase(entry: ErrorLogEntry) {
    try {
      await db.execute(sql`
        INSERT INTO error_logs (level, message, context, user_id, metadata, stack, created_at)
        VALUES (${entry.level}, ${entry.message}, ${entry.context || null}, 
                ${entry.userId || null}, ${JSON.stringify(entry.metadata || {})}, 
                ${entry.stack || null}, NOW())
      `);
    } catch (dbError) {
      // Fallback to console if DB logging fails
      console.error('[ErrorLogger] Failed to log to database:', dbError);
      console.error('[ErrorLogger] Original error:', entry);
    }
  }

  private static formatLogMessage(entry: ErrorLogEntry): string {
    const timestamp = new Date().toISOString();
    const contextStr = entry.context ? ` [${entry.context}]` : '';
    const userStr = entry.userId ? ` user=${entry.userId}` : '';
    return `[${timestamp}] ${entry.level.toUpperCase()}${contextStr}${userStr}: ${entry.message}`;
  }

  static error(message: string, context?: string, error?: Error, userId?: string, metadata?: Record<string, any>) {
    const entry: ErrorLogEntry = {
      level: 'error',
      message,
      context,
      userId,
      metadata,
      stack: error?.stack
    };
    
    console.error(this.formatLogMessage(entry));
    if (error) console.error(error);
    
    this.logToDatabase(entry);
  }

  static warn(message: string, context?: string, userId?: string, metadata?: Record<string, any>) {
    const entry: ErrorLogEntry = {
      level: 'warn',
      message,
      context,
      userId,
      metadata
    };
    
    console.warn(this.formatLogMessage(entry));
    this.logToDatabase(entry);
  }

  static info(message: string, context?: string, userId?: string, metadata?: Record<string, any>) {
    const entry: ErrorLogEntry = {
      level: 'info',
      message,
      context,
      userId,
      metadata
    };
    
    console.log(this.formatLogMessage(entry));
    this.logToDatabase(entry);
  }

  static debug(message: string, context?: string, userId?: string, metadata?: Record<string, any>) {
    if (process.env.NODE_ENV === 'development') {
      const entry: ErrorLogEntry = {
        level: 'debug',
        message,
        context,
        userId,
        metadata
      };
      
      console.debug(this.formatLogMessage(entry));
      // Don't log debug to database in production
      if (process.env.NODE_ENV === 'development') {
        this.logToDatabase(entry);
      }
    }
  }

  // Specific helper for tool execution errors
  static toolError(toolName: string, error: Error, args?: any, userId?: string) {
    this.error(
      `Tool execution failed: ${toolName}`,
      'ToolExecution',
      error,
      userId,
      { toolName, args: args ? JSON.stringify(args).substring(0, 1000) : undefined }
    );
  }

  // Specific helper for API errors
  static apiError(endpoint: string, error: Error, status?: number, userId?: string) {
    this.error(
      `API error at ${endpoint}: ${error.message}`,
      'API',
      error,
      userId,
      { endpoint, status }
    );
  }
}