/**
 * Core uploader implementation with retry logic and multi-file support
 */

import type {
  UploaderConfig,
  Uploader,
  UploadOptions,
  UploadManyOptions,
  UploadControl,
  UploadManyResult,
  UploadResult,
  UploadProgress,
  PresignConfig,
  RetryConfig,
  Transport,
} from '../types.js';
import {
  UploadError,
  createErrorFromResponse,
  normalizeError,
  isRetryableError,
  requiresReinit,
} from './errors.js';
import { createTransport } from './xhr.js';

// Default retry configuration
const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  retries: 0,
  backoff: 'exponential',
  minDelayMs: 500,
  maxDelayMs: 4000,
  reinitOnAuthError: true,
};

// Sleep utility for retry delays
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate retry delay based on backoff strategy
function calculateRetryDelay(
  attempt: number,
  config: Required<RetryConfig>
): number {
  const { backoff, minDelayMs, maxDelayMs } = config;
  
  let delay: number;
  if (backoff === 'linear') {
    delay = minDelayMs * attempt;
  } else {
    // exponential backoff
    delay = minDelayMs * Math.pow(2, attempt - 1);
  }
  
  return Math.min(delay, maxDelayMs);
}

// Initialize presigned URL from backend
async function initializePresign(
  config: UploaderConfig,
  file: File,
  signal?: AbortSignal
): Promise<PresignConfig> {
  const { init } = config;
  
  try {
    // Prepare headers
    let headers: HeadersInit = {};
    if (init.headers) {
      headers = typeof init.headers === 'function' ? init.headers() : init.headers;
    }
    
    // Prepare request options
    const requestOptions: RequestInit = {
      method: init.method || 'POST',
      headers,
    };
    
    if (signal) {
      requestOptions.signal = signal;
    }
    
    // Add body for POST requests
    if (requestOptions.method === 'POST' && init.buildPayload) {
      const payload = init.buildPayload({ file });
      requestOptions.body = JSON.stringify(payload);
      
      // Ensure content-type is set for JSON payload
      if (!headers || !Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
        requestOptions.headers = {
          ...headers,
          'Content-Type': 'application/json',
        };
      }
    }
    
    // Make request
    const response = await fetch(init.url, requestOptions);
    
    if (!response.ok) {
      let responseBody: unknown;
      try {
        responseBody = await response.json();
      } catch {
        try {
          responseBody = await response.text();
        } catch {
          responseBody = undefined;
        }
      }
      
      throw createErrorFromResponse('init', response.status, response.statusText, responseBody);
    }
    
    // Parse response
    const responseData = await response.json();
    
    // Map response to standard format
    return init.mapResponse(responseData);
  } catch (error) {
    if (error instanceof UploadError) {
      throw error;
    }
    throw normalizeError(error, 'init', 'Failed to initialize presigned URL');
  }
}

// Single file upload with retry logic
async function uploadWithRetry(
  config: UploaderConfig,
  transport: Transport,
  file: File,
  options: UploadOptions = {}
): Promise<UploadResult> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retry };
  const { onProgress, signal } = options;
  
  let presignConfig: PresignConfig | null = null;
  let lastError: UploadError | null = null;
  
  for (let attempt = 1; attempt <= retryConfig.retries + 1; attempt++) {
    try {
      // Check if aborted
      if (signal?.aborted) {
        throw normalizeError(new Error('Aborted'), 'upload');
      }
      
      // Initialize or re-initialize if needed
      if (!presignConfig || (lastError && requiresReinit(lastError) && retryConfig.reinitOnAuthError)) {
        presignConfig = await initializePresign(config, file, signal);
      }
      
      // Attempt upload
      const transportOptions: {
        onProgress?: (progress: UploadProgress) => void;
        signal?: AbortSignal;
        progressIntervalMs?: number;
      } = {};
      
      if (onProgress) {
        transportOptions.onProgress = onProgress;
      }
      
      if (signal) {
        transportOptions.signal = signal;
      }
      
      if (config.progressIntervalMs !== undefined) {
        transportOptions.progressIntervalMs = config.progressIntervalMs;
      }
      
      return await transport.upload(presignConfig, file, transportOptions);
    } catch (error) {
      const uploadError = normalizeError(error, presignConfig ? 'upload' : 'init');
      lastError = uploadError;
      
      // Don't retry if this is the last attempt
      if (attempt >= retryConfig.retries + 1) {
        throw uploadError;
      }
      
      // Don't retry if error is not retryable
      if (!isRetryableError(uploadError)) {
        throw uploadError;
      }
      
      // Don't retry if aborted
      if (signal?.aborted) {
        throw uploadError;
      }
      
      // Calculate and wait for retry delay
      const delay = calculateRetryDelay(attempt, retryConfig);
      await sleep(delay);
    }
  }
  
  // This should never be reached, but TypeScript needs it
  throw lastError || new Error('Upload failed for unknown reason');
}

// Concurrency control for multi-file uploads
class ConcurrencyController {
  private running = 0;
  private queue: Array<() => void> = [];
  
  constructor(private maxConcurrency: number) {}
  
  async execute<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const executeTask = async () => {
        this.running++;
        try {
          const result = await task();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          this.running--;
          this.processQueue();
        }
      };
      
      if (this.running < this.maxConcurrency) {
        executeTask();
      } else {
        this.queue.push(executeTask);
      }
    });
  }
  
  private processQueue(): void {
    if (this.queue.length > 0 && this.running < this.maxConcurrency) {
      const nextTask = this.queue.shift();
      if (nextTask) {
        nextTask();
      }
    }
  }
}

// Main uploader implementation
export class UploaderImpl implements Uploader {
  private transport: Transport;
  
  constructor(private config: UploaderConfig) {
    this.transport = createTransport(config.transport || 'xhr');
  }
  
  upload(file: File, opts: UploadOptions = {}): UploadControl {
    const abortController = new AbortController();
    const signal = opts.signal;
    
    // Combine signals if provided
    let combinedSignal = abortController.signal;
    if (signal) {
      if (signal.aborted) {
        abortController.abort();
      } else {
        signal.addEventListener('abort', () => abortController.abort());
      }
    }
    
    const promise = uploadWithRetry(this.config, this.transport, file, {
      ...opts,
      signal: combinedSignal,
    });
    
    return {
      promise,
      cancel: () => abortController.abort(),
    };
  }
  
  async uploadMany(files: File[], opts: UploadManyOptions = {}): Promise<UploadManyResult> {
    const {
      concurrency = 3,
      onEachProgress,
      onOverallProgress,
      signal,
    } = opts;
    
    const controller = new ConcurrencyController(concurrency);
    const results: PromiseSettledResult<UploadResult>[] = [];
    const progressMap = new Map<number, UploadProgress>();
    
    // Track overall progress
    const updateOverallProgress = () => {
      if (!onOverallProgress) return;
      
      let totalBytes = 0;
      let totalSent = 0;
      
      files.forEach((file, index) => {
        totalBytes += file.size;
        const progress = progressMap.get(index);
        if (progress) {
          totalSent += progress.bytesSent;
        }
      });
      
      const percent = totalBytes > 0 ? Math.round((totalSent / totalBytes) * 100) : 0;
      
      onOverallProgress({
        bytesSent: totalSent,
        totalBytes,
        percent,
      });
    };
    
    // Create upload tasks
    const uploadTasks = files.map((file, index) => {
      return controller.execute(async () => {
        const uploadOptions: UploadOptions = {
          ...(onEachProgress && {
            onProgress: (progress) => {
              progressMap.set(index, progress);
              onEachProgress(index, progress);
              updateOverallProgress();
            }
          }),
          ...(signal && { signal })
        };
        
        const { promise } = this.upload(file, uploadOptions);
        
        return promise;
      });
    });
    
    // Wait for all uploads to complete
    const settledResults = await Promise.allSettled(uploadTasks);
    results.push(...settledResults);
    
    // Final progress update
    updateOverallProgress();
    
    return { results };
  }
}

// Factory function to create uploader instance
export function createUploader(config: UploaderConfig): Uploader {
  return new UploaderImpl(config);
}