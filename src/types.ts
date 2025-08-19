/**
 * Core types for S3 presigned upload library
 */

// Upload progress information
export interface UploadProgress {
  bytesSent: number;
  totalBytes: number;
  percent: number;
}

// Upload result after successful completion
export interface UploadResult {
  key: string;
  location?: string;
  etag?: string;
  mode: 'put' | 'post';
}

// Presigned PUT configuration
export interface PresignPut {
  mode: 'put';
  uploadUrl: string;
  key: string;
  headers?: Record<string, string>;
  expiresAt?: number;
}

// Presigned POST policy configuration
export interface PresignPost {
  mode: 'post';
  uploadUrl: string;
  key: string;
  fields: Record<string, string>;
  postFileFieldName?: string;
  expiresAt?: number;
}

// Union type for presigned configurations
export type PresignConfig = PresignPut | PresignPost;

// Retry configuration
export interface RetryConfig {
  retries?: number;
  backoff?: 'linear' | 'exponential';
  minDelayMs?: number;
  maxDelayMs?: number;
  reinitOnAuthError?: boolean;
}

// Init endpoint configuration
export interface InitConfig {
  url: string;
  method?: 'POST' | 'GET';
  headers?: HeadersInit | (() => HeadersInit);
  buildPayload?: (ctx: { file: File }) => any;
  mapResponse: (res: any) => PresignConfig;
}

// Main uploader configuration
export interface UploaderConfig {
  init: InitConfig;
  retry?: RetryConfig;
  transport?: 'xhr' | 'fetch';
  progressIntervalMs?: number;
}

// Upload options for single file
export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

// Upload options for multiple files
export interface UploadManyOptions {
  concurrency?: number;
  onEachProgress?: (index: number, progress: UploadProgress) => void;
  onOverallProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

// Upload control interface
export interface UploadControl {
  promise: Promise<UploadResult>;
  cancel: () => void;
}

// Upload many result
export interface UploadManyResult {
  results: PromiseSettledResult<UploadResult>[];
}

// Main uploader interface
export interface Uploader {
  upload(file: File, opts?: UploadOptions): UploadControl;
  uploadMany(files: File[], opts?: UploadManyOptions): Promise<UploadManyResult>;
}

// Internal transport interface
export interface Transport {
  upload(
    config: PresignConfig,
    file: File,
    options: {
      onProgress?: (progress: UploadProgress) => void;
      signal?: AbortSignal;
      progressIntervalMs?: number;
    }
  ): Promise<UploadResult>;
}

// Internal context for upload operations
export interface UploadContext {
  file: File;
  config: PresignConfig;
  attempt: number;
  maxRetries: number;
  retryConfig: Required<RetryConfig>;
}