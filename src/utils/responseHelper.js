/**
 * Standardized Response Helper for Swift Haven Backend
 * Ensures consistent response format across all APIs
 */

/**
 * Send success response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Success message
 * @param {Object} data - Response data
 * @param {Object} meta - Additional metadata (pagination, etc.)
 */
const sendSuccess = (res, statusCode = 200, message = 'Success', data = null, meta = null) => {
  const response = {
    success: true,
    message,
    statusCode
  };

  if (data !== null) {
    response.data = data;
  }

  if (meta !== null) {
    response.meta = meta;
  }

  return res.status(statusCode).json(response);
};

/**
 * Send error response
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 * @param {Object} errors - Additional error details
 */
const sendError = (res, statusCode = 500, message = 'Internal Server Error', errors = null) => {
  const response = {
    success: false,
    message,
    statusCode
  };

  if (errors !== null) {
    response.errors = errors;
  }

  return res.status(statusCode).json(response);
};

/**
 * Send validation error response
 * @param {Object} res - Express response object
 * @param {string} message - Validation error message
 * @param {Object} validationErrors - Field-specific validation errors
 */
const sendValidationError = (res, message = 'Validation failed', validationErrors = null) => {
  return sendError(res, 400, message, validationErrors);
};

/**
 * Send not found error response
 * @param {Object} res - Express response object
 * @param {string} message - Not found message
 */
const sendNotFound = (res, message = 'Resource not found') => {
  return sendError(res, 404, message);
};

/**
 * Send unauthorized error response
 * @param {Object} res - Express response object
 * @param {string} message - Unauthorized message
 */
const sendUnauthorized = (res, message = 'Unauthorized access') => {
  return sendError(res, 401, message);
};

/**
 * Send forbidden error response
 * @param {Object} res - Express response object
 * @param {string} message - Forbidden message
 */
const sendForbidden = (res, message = 'Access forbidden') => {
  return sendError(res, 403, message);
};

/**
 * Send conflict error response
 * @param {Object} res - Express response object
 * @param {string} message - Conflict message
 */
const sendConflict = (res, message = 'Resource conflict') => {
  return sendError(res, 409, message);
};

/**
 * Send paginated response
 * @param {Object} res - Express response object
 * @param {string} message - Success message
 * @param {Array} data - Response data array
 * @param {Object} pagination - Pagination info
 */
const sendPaginated = (res, message = 'Data retrieved successfully', data = [], pagination = {}) => {
  const response = {
    success: true,
    message,
    statusCode: 200,
    data,
    meta: {
      pagination: {
        page: pagination.page || 1,
        limit: pagination.limit || 10,
        total: pagination.total || 0,
        totalPages: Math.ceil((pagination.total || 0) / (pagination.limit || 10))
      }
    }
  };

  return res.status(200).json(response);
};

/**
 * Handle async errors consistently
 * @param {Function} fn - Async function to wrap
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      console.error('Async Handler Error:', error);
      
      // If it's a known error with message, use it
      if (error.message) {
        return sendError(res, 500, error.message);
      }
      
      // Default server error
      return sendError(res, 500, 'Internal Server Error');
    });
  };
};

module.exports = {
  sendSuccess,
  sendError,
  sendValidationError,
  sendNotFound,
  sendUnauthorized,
  sendForbidden,
  sendConflict,
  sendPaginated,
  asyncHandler
};
