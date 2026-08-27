// import { Prisma } from '@prisma/client';
import {
    PrismaClientKnownRequestError,
    PrismaClientValidationError,
} from '@prisma/client/runtime/library';
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

// Handle Prisma-specific errors
export const handlePrismaError = (error: any): AppError => {
    if (error instanceof PrismaClientKnownRequestError) {
        // Handle known Prisma errors
        switch (error.code) {
            case 'P2002': // Unique constraint violation
                return new AppError(
                    'A record with this value already exists.',
                    ErrorType.VALIDATION,
                    409,
                    { fields: error.meta?.target }
                );
            case 'P2025': // Record not found
                return new AppError(
                    'Record not found.',
                    ErrorType.NOT_FOUND,
                    404
                );
            case 'P2003': // Foreign key constraint failed
                return new AppError(
                    'Operation failed due to a relation constraint.',
                    ErrorType.VALIDATION,
                    400,
                    { fields: error.meta?.field_name }
                );
            default:
                logger.error(`Unhandled Prisma error: ${error.code}`, error);
                return new AppError(
                    'Database operation failed.',
                    ErrorType.DATABASE,
                    500
                );
        }
    } else if (error instanceof PrismaClientValidationError) {
        // Handle validation errors
        return new AppError(
            'Invalid data provided.',
            ErrorType.VALIDATION,
            400
        );
    } else if (error instanceof AppError) {
        // Pass through our custom errors
        return error;
    } else {
        // Handle unknown errors
        logger.error('Unknown error:', error);
        return new AppError(
            'An unexpected error occurred.',
            ErrorType.INTERNAL,
            500
        );
    }
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