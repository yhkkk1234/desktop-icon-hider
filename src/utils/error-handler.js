const logger = require('./logger');

class AppError extends Error {
  constructor(message, code = 'UNKNOWN_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }
}

class WindowError extends AppError {
  constructor(message, details = null) {
    super(message, 'WINDOW_ERROR', details);
  }
}

class APIError extends AppError {
  constructor(message, details = null) {
    super(message, 'API_ERROR', details);
  }
}

class ConfigError extends AppError {
  constructor(message, details = null) {
    super(message, 'CONFIG_ERROR', details);
  }
}

function handleError(error, context = 'Unknown') {
  logger.error(`Error in ${context}:`, {
    message: error.message,
    code: error.code,
    details: error.details,
    stack: error.stack
  });
  
  return {
    success: false,
    error: error.message,
    code: error.code,
    context: context
  };
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(error => {
      handleError(error, 'Async Handler');
      next(error);
    });
  };
}

function wrapAsync(fn) {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (error) {
      logger.error('Async function error:', {
        message: error.message,
        stack: error.stack
      });
      throw error;
    }
  };
}

function createErrorResponse(message, code = 'ERROR', details = null) {
  return {
    success: false,
    error: message,
    code: code,
    details: details
  };
}

function createSuccessResponse(data = null, message = 'Success') {
  return {
    success: true,
    message: message,
    data: data
  };
}

module.exports = {
  AppError,
  WindowError,
  APIError,
  ConfigError,
  handleError,
  asyncHandler,
  wrapAsync,
  createErrorResponse,
  createSuccessResponse
};
