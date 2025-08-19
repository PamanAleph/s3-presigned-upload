/**
 * Error handling system for S3 presigned upload library
 */

// Error codes for different failure scenarios
export type UploadErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'EXPIRED'
  | 'ABORTED'
  | 'BAD_REQUEST'
  | 'SERVER';

// Upload phases where errors can occur
export type UploadPhase = 'init' | 'upload';

// Custom error class for upload operations
export class UploadError extends Error {
  override readonly name = 'UploadError';
  public readonly phase: UploadPhase;
  public readonly code: UploadErrorCode;
  public readonly status?: number;
  public readonly detail?: unknown;

  constructor(
    message: string,
    phase: UploadPhase,
    code: UploadErrorCode,
    status?: number,
    detail?: unknown
  ) {
    super(message);
    this.phase = phase;
    this.code = code;
    this.status = status;
    this.detail = detail;

    // Maintain proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, UploadError);
    }
  }
}

// Helper function to create network errors
export function createNetworkError(
  phase: UploadPhase,
  message: string,
  detail?: unknown
): UploadError {
  return new UploadError(message, phase, 'NETWORK', undefined, detail);
}

// Helper function to create timeout errors
export function createTimeoutError(
  phase: UploadPhase,
  message: string = 'Request timed out'
): UploadError {
  return new UploadError(message, phase, 'TIMEOUT');
}

// Helper function to create abort errors
export function createAbortError(
  phase: UploadPhase,
  message: string = 'Upload was aborted'
): UploadError {
  return new UploadError(message, phase, 'ABORTED');
}

// Helper function to create expired errors
export function createExpiredError(
  phase: UploadPhase,
  message: string = 'Presigned URL has expired'
): UploadError {
  return new UploadError(message, phase, 'EXPIRED', 403);
}

// Helper function to create server errors
export function createServerError(
  phase: UploadPhase,
  status: number,
  message: string,
  detail?: unknown
): UploadError {
  return new UploadError(message, phase, 'SERVER', status, detail);
}

// Helper function to create bad request errors
export function createBadRequestError(
  phase: UploadPhase,
  status: number,
  message: string,
  detail?: unknown
): UploadError {
  return new UploadError(message, phase, 'BAD_REQUEST', status, detail);
}

// Helper function to determine if an error is retryable
export function isRetryableError(error: UploadError): boolean {
  // Network errors are always retryable
  if (error.code === 'NETWORK' || error.code === 'TIMEOUT') {
    return true;
  }

  // Server errors (5xx) are retryable
  if (error.code === 'SERVER' && error.status && error.status >= 500) {
    return true;
  }

  // Expired errors (403) are retryable if reinit is enabled
  if (error.code === 'EXPIRED' && error.status === 403) {
    return true;
  }

  // Other errors are not retryable
  return false;
}

// Helper function to determine if an error requires re-initialization
export function requiresReinit(error: UploadError): boolean {
  return error.code === 'EXPIRED' && error.status === 403;
}

// Helper function to convert generic errors to UploadError
export function normalizeError(
  error: unknown,
  phase: UploadPhase,
  defaultMessage: string = 'An unexpected error occurred'
): UploadError {
  // Already an UploadError
  if (error instanceof UploadError) {
    return error;
  }

  // AbortError from fetch or XHR
  if (error instanceof Error && error.name === 'AbortError') {
    return createAbortError(phase, error.message);
  }

  // TimeoutError
  if (error instanceof Error && error.name === 'TimeoutError') {
    return createTimeoutError(phase, error.message);
  }

  // Generic Error
  if (error instanceof Error) {
    return createNetworkError(phase, error.message, error);
  }

  // Unknown error type
  return createNetworkError(phase, defaultMessage, error);
}

// Helper function to convert HTTP response to UploadError
export function createErrorFromResponse(
  phase: UploadPhase,
  status: number,
  statusText: string,
  responseBody?: unknown
): UploadError {
  const message = `HTTP ${status}: ${statusText}`;

  // 4xx client errors
  if (status >= 400 && status < 500) {
    if (status === 403) {
      return createExpiredError(phase, message);
    }
    return createBadRequestError(phase, status, message, responseBody);
  }

  // 5xx server errors
  if (status >= 500) {
    return createServerError(phase, status, message, responseBody);
  }

  // Other status codes
  return createNetworkError(phase, message, { status, statusText, responseBody });
}