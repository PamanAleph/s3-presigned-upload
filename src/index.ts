/**
 * @pamanaleph/s3-presigned-upload
 * 
 * Simple TypeScript library for S3 presigned URL uploads with progress tracking and retry logic
 */

// Export main factory function
export { createUploader } from './core/createUploader.js';

// Export all public types
export type {
  // Main interfaces
  Uploader,
  UploaderConfig,
  
  // Configuration types
  InitConfig,
  RetryConfig,
  
  // Presigned URL types
  PresignPut,
  PresignPost,
  PresignConfig,
  
  // Upload operation types
  UploadOptions,
  UploadManyOptions,
  UploadControl,
  UploadManyResult,
  
  // Result and progress types
  UploadResult,
  UploadProgress,
  
  // Transport interface (for advanced users)
  Transport,
} from './types.js';

// Export error types and utilities
export {
  UploadError,
  type UploadErrorCode,
  type UploadPhase,
  
  // Error creation helpers
  createNetworkError,
  createTimeoutError,
  createAbortError,
  createExpiredError,
  createServerError,
  createBadRequestError,
  
  // Error utility functions
  isRetryableError,
  requiresReinit,
  normalizeError,
  createErrorFromResponse,
} from './core/errors.js';

// Export transport factory (for advanced users)
export { createTransport } from './core/xhr.js';