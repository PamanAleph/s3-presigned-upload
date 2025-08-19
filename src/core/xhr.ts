/**
 * Transport implementations for S3 presigned upload
 * Supports both XHR (with progress) and fetch (without progress)
 */

import type { PresignConfig, UploadProgress, UploadResult, Transport } from '../types.ts';
import {
  createAbortError,
  createErrorFromResponse,
  createNetworkError,
  createTimeoutError,
  normalizeError,
} from './errors.ts';

// Progress throttling utility
class ProgressThrottler {
  private lastEmit = 0;
  private intervalMs: number;

  constructor(intervalMs: number = 120) {
    this.intervalMs = intervalMs;
  }

  shouldEmit(): boolean {
    const now = Date.now();
    if (now - this.lastEmit >= this.intervalMs) {
      this.lastEmit = now;
      return true;
    }
    return false;
  }

  forceEmit(): void {
    this.lastEmit = Date.now();
  }
}

// XHR-based transport with upload progress
export class XHRTransport implements Transport {
  async upload(
    config: PresignConfig,
    file: File,
    options: {
      onProgress?: (progress: UploadProgress) => void;
      signal?: AbortSignal;
      progressIntervalMs?: number;
    } = {}
  ): Promise<UploadResult> {
    const { onProgress, signal, progressIntervalMs = 120 } = options;
    const throttler = new ProgressThrottler(progressIntervalMs);

    return new Promise<UploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let isAborted = false;

      // Handle abort signal
      const handleAbort = () => {
        if (!isAborted) {
          isAborted = true;
          xhr.abort();
          reject(createAbortError('upload'));
        }
      };

      if (signal) {
        if (signal.aborted) {
          reject(createAbortError('upload'));
          return;
        }
        signal.addEventListener('abort', handleAbort);
      }

      // Upload progress tracking
      if (onProgress && xhr.upload) {
        xhr.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable && (throttler.shouldEmit() || event.loaded === event.total)) {
            const progress: UploadProgress = {
              bytesSent: event.loaded,
              totalBytes: event.total,
              percent: Math.round((event.loaded / event.total) * 100),
            };
            onProgress(progress);
          }
        });
      }

      // Handle response
      xhr.addEventListener('load', () => {
        if (signal) {
          signal.removeEventListener('abort', handleAbort);
        }

        if (isAborted) return;

        const status = xhr.status;
        const statusText = xhr.statusText;

        if (status >= 200 && status < 300) {
          // Success - extract result information
          const etag = xhr.getResponseHeader('ETag')?.replace(/"/g, '') || undefined;
          const location = xhr.getResponseHeader('Location') || undefined;

          resolve({
            key: config.key,
            location,
            etag,
            mode: config.mode,
          });
        } else {
          // HTTP error
          let responseBody: unknown;
          try {
            responseBody = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
          } catch {
            responseBody = xhr.responseText;
          }

          reject(createErrorFromResponse('upload', status, statusText, responseBody));
        }
      });

      // Handle network errors
      xhr.addEventListener('error', () => {
        if (signal) {
          signal.removeEventListener('abort', handleAbort);
        }
        if (!isAborted) {
          reject(createNetworkError('upload', 'Network error occurred during upload'));
        }
      });

      // Handle timeout
      xhr.addEventListener('timeout', () => {
        if (signal) {
          signal.removeEventListener('abort', handleAbort);
        }
        if (!isAborted) {
          reject(createTimeoutError('upload', 'Upload request timed out'));
        }
      });

      // Handle abort
      xhr.addEventListener('abort', () => {
        if (signal) {
          signal.removeEventListener('abort', handleAbort);
        }
        if (!isAborted) {
          reject(createAbortError('upload'));
        }
      });

      try {
        // Configure request based on presign type
        if (config.mode === 'put') {
          // PUT request
          xhr.open('PUT', config.uploadUrl);

          // Set headers
          if (config.headers) {
            Object.entries(config.headers).forEach(([key, value]) => {
              xhr.setRequestHeader(key, value);
            });
          }

          // Send file directly
          xhr.send(file);
        } else {
          // POST request with form data
          xhr.open('POST', config.uploadUrl);

          // Build form data
          const formData = new FormData();

          // Add all policy fields first
          Object.entries(config.fields).forEach(([key, value]) => {
            formData.append(key, value);
          });

          // Add file last (required by S3)
          const fileFieldName = config.postFileFieldName || 'file';
          formData.append(fileFieldName, file);

          // Send form data
          xhr.send(formData);
        }
      } catch (error) {
        if (signal) {
          signal.removeEventListener('abort', handleAbort);
        }
        reject(normalizeError(error, 'upload', 'Failed to initiate upload request'));
      }
    });
  }
}

// Fetch-based transport (no upload progress)
export class FetchTransport implements Transport {
  async upload(
    config: PresignConfig,
    file: File,
    options: {
      onProgress?: (progress: UploadProgress) => void;
      signal?: AbortSignal;
      progressIntervalMs?: number;
    } = {}
  ): Promise<UploadResult> {
    const { signal } = options;

    try {
      let response: Response;

      if (config.mode === 'put') {
        // PUT request
        response = await fetch(config.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: config.headers,
          signal,
        });
      } else {
        // POST request with form data
        const formData = new FormData();

        // Add all policy fields first
        Object.entries(config.fields).forEach(([key, value]) => {
          formData.append(key, value);
        });

        // Add file last
        const fileFieldName = config.postFileFieldName || 'file';
        formData.append(fileFieldName, file);

        response = await fetch(config.uploadUrl, {
          method: 'POST',
          body: formData,
          signal,
        });
      }

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

        throw createErrorFromResponse('upload', response.status, response.statusText, responseBody);
      }

      // Extract result information
      const etag = response.headers.get('ETag')?.replace(/"/g, '') || undefined;
      const location = response.headers.get('Location') || undefined;

      return {
        key: config.key,
        location,
        etag,
        mode: config.mode,
      };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw createAbortError('upload', error.message);
      }
      throw normalizeError(error, 'upload', 'Upload request failed');
    }
  }
}

// Factory function to create transport instance
export function createTransport(type: 'xhr' | 'fetch' = 'xhr'): Transport {
  switch (type) {
    case 'xhr':
      return new XHRTransport();
    case 'fetch':
      return new FetchTransport();
    default:
      throw new Error(`Unsupported transport type: ${type}`);
  }
}