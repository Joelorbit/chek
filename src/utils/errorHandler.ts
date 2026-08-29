import logger from './logger';
import { Response } from 'express';

// Error types for better error handling
export enum ErrorType {
    NOT_FOUND = 'NOT_FOUND',
    VALIDATION = 'VALIDATION',
    UNAUTHORIZED = 'UNAUTHORIZED',
    FORBIDDEN = 'FORBIDDEN',
    DATABASE = 'DATABASE',
    INTERNAL = 'INTERNAL',
}

// Custom error class with type and status code
export class AppError extends Error {
    type: ErrorType;
    statusCode: number;
    details?: any;

    constructor(message: string, type: ErrorType, statusCode: number, details?: any) {
        super(message);
        this.type = type;
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'AppError';
    }
}

// Handle database / general errors
export const handlePrismaError = (error: any): AppError => {
    if (error instanceof AppError) {
        // Pass through our custom errors
        return error;
    }

    // Postgres / Drizzle error codes
    const code = (error as any)?.code;
    if (code === '23505') {
        // unique_violation
        return new AppError(
            'A record with this value already exists.',
            ErrorType.VALIDATION,
            409
        );
    }
    if (code === '23503') {
        // foreign_key_violation
        return new AppError(
            'Operation failed due to a relation constraint.',
            ErrorType.VALIDATION,
            400
        );
    }

    // Handle unknown errors
    logger.error('Unknown error:', error);
    return new AppError(
        'An unexpected error occurred.',
        ErrorType.INTERNAL,
        500
    );
};

// Send error response
export const sendErrorResponse = (res: Response, error: any) => {
    const appError = handlePrismaError(error);

    res.status(appError.statusCode).json({
        success: false,
        error: appError.message,
        ...(process.env.NODE_ENV === 'development' && { details: appError.details })
    });
};