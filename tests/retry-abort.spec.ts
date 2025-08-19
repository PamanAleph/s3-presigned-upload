/**
 * Tests for retry logic and abort functionality
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createUploader, UploadError } from '../src/index.js';
import { createTestFile, server } from './setup.js';
import type { UploaderConfig } from '../src/types.js';

describe('Retry and Abort Logic', () => {
  beforeEach(() => {
    vi.clearAllTimers();
    vi.useFakeTimers();
  });

  const createRetryUploader = (overrides: Partial<UploaderConfig> = {}) => {
    return createUploader({
      init: {
        url: '/api/upload/init',
        method: 'POST',
        buildPayload: ({ file }) => ({ filename: file.name }),
        mapResponse: (res) => res,
      },
      retry: {
        retries: 3,
        backoff: 'exponential',
        minDelayMs: 100,
        maxDelayMs: 1000,
        reinitOnAuthError: true,
        ...overrides.retry,
      },
      transport: 'xhr',
      ...overrides,
    });
  };

  describe('Server Error Retry (5xx)', () => {
    it('should retry on 500 server error', async () => {
      let attemptCount = 0;
      
      // Mock server to fail twice, then succeed
      server.use(
        http.put('https://test-bucket.s3.amazonaws.com/test-key', () => {
          attemptCount++;
          if (attemptCount <= 2) {
            return HttpResponse.json(
              { error: 'Internal server error' },
              { status: 500 }
            );
          }
          return new HttpResponse(null, {
            status: 200,
            headers: { 'ETag': '"success"' },
          });
        })
      );
      
      const uploader = createRetryUploader();
      const file = createTestFile('test.png', 1024);
      
      const uploadPromise = uploader.upload(file).promise;
      
      // Fast-forward through retry delays
      await vi.runAllTimersAsync();
      
      const result = await uploadPromise;
      
      expect(result.etag).toBe('success');
      expect(attemptCount).toBe(3); // 2 failures + 1 success
    });

    it('should fail after max retries on persistent 500 error', async () => {
      server.use(
        http.put('https://test-bucket.s3.amazonaws.com/test-key', () => {
          return HttpResponse.json(
            { error: 'Persistent server error' },
            { status: 500 }
          );
        })
      );
      
      const uploader = createRetryUploader();
      const file = createTestFile('test.png', 1024);
      
      const uploadPromise = uploader.upload(file).promise;
      
      // Fast-forward through all retry attempts
      await vi.runAllTimersAsync();
      
      await expect(uploadPromise).rejects.toThrow(UploadError);
      await expect(uploadPromise).rejects.toMatchObject({
        code: 'SERVER',
        status: 500,
        phase: 'upload',
      });
    });
  });

  describe('Auth Error Retry (403)', () => {
    it('should reinit and retry on 403 expired error', async () => {
      let initAttempts = 0;
      let uploadAttempts = 0;
      
      // Mock init endpoint to track calls
      server.use(
        http.post('/api/upload/init', () => {
          initAttempts++;
          return HttpResponse.json({
            mode: 'put',
            uploadUrl: 'https://test-bucket.s3.amazonaws.com/test-key',
            key: 'test-key',
          });
        })
      );
      
      // Mock upload to fail with 403 once, then succeed
      server.use(
        http.put('https://test-bucket.s3.amazonaws.com/test-key', () => {
          uploadAttempts++;
          if (uploadAttempts === 1) {
            return HttpResponse.json(
              { error: 'Request has expired' },
              { status: 403 }
            );
          }
          return new HttpResponse(null, {
            status: 200,
            headers: { 'ETag': '"success-after-reinit"' },
          });
        })
      );
      
      const uploader = createRetryUploader();
      const file = createTestFile('test.png', 1024);
      
      const uploadPromise = uploader.upload(file).promise;
      
      // Fast-forward through retry delays
      await vi.runAllTimersAsync();
      
      const result = await uploadPromise;
      
      expect(result.etag).toBe('success-after-reinit');
      expect(initAttempts).toBe(2); // Initial + reinit
      expect(uploadAttempts).toBe(2); // Failed + success
    });

    it('should not reinit when reinitOnAuthError is false', async () => {
      let initAttempts = 0;
      
      server.use(
        http.post('/api/upload/init', () => {
          initAttempts++;
          return HttpResponse.json({
            mode: 'put',
            uploadUrl: 'https://test-bucket.s3.amazonaws.com/test-key',
            key: 'test-key',
          });
        }),
        http.put('https://test-bucket.s3.amazonaws.com/test-key', () => {
          return HttpResponse.json(
            { error: 'Request has expired' },
            { status: 403 }
          );
        })
      );
      
      const uploader = createRetryUploader({
        retry: { reinitOnAuthError: false, retries: 2 },
      });
      const file = createTestFile('test.png', 1024);
      
      const uploadPromise = uploader.upload(file).promise;
      
      await vi.runAllTimersAsync();
      
      await expect(uploadPromise).rejects.toThrow(UploadError);
      expect(initAttempts).toBe(1); // Only initial init, no reinit
    });
  });

  describe('Network Error Retry', () => {
    it('should retry on network errors', async () => {
      let attemptCount = 0;
      
      server.use(
        http.put('https://test-bucket.s3.amazonaws.com/test-key', () => {
          attemptCount++;
          if (attemptCount <= 2) {
            // Simulate network error
            return HttpResponse.error();
          }
          return new HttpResponse(null, {
            status: 200,
            headers: { 'ETag': '"network-retry-success"' },
          });
        })
      );
      
      const uploader = createRetryUploader();
      const file = createTestFile('test.png', 1024);
      
      const uploadPromise = uploader.upload(file).promise;
      
      await vi.runAllTimersAsync();
      
      const result = await uploadPromise;
      expect(result.etag).toBe('network-retry-success');
      expect(attemptCount).toBe(3);
    });
  });

  describe('Non-Retryable Errors', () => {
    it('should not retry on 400 bad request', async () => {
      let attemptCount = 0;
      
      server.use(
        http.put('https://test-bucket.s3.amazonaws.com/test-key', () => {
          attemptCount++;
          return HttpResponse.json(
            { error: 'Bad request' },
            { status: 400 }
          );
        })
      );
      
      const uploader = createRetryUploader();
      const file = createTestFile('test.png', 1024);
      
      const uploadPromise = uploader.upload(file).promise;
      
      await vi.runAllTimersAsync();
      
      await expect(uploadPromise).rejects.toThrow(UploadError);
      expect(attemptCount).toBe(1); // No retries for 400 errors
    });
  });

  describe('Backoff Strategies', () => {
    it('should use linear backoff when configured', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;
      
      vi.spyOn(global, 'setTimeout').mockImplementation((callback, delay) => {
        if (typeof delay === 'number' && delay > 0) {
          delays.push(delay);
        }
        return originalSetTimeout(callback, 0); // Execute immediately for test
      });
      
      server.use(
        http.put('https://test-bucket.s3.amazonaws.com/test-key', () => {
          return HttpResponse.json(
            { error: 'Server error' },
            { status: 500 }
          );
        })
      );
      
      const uploader = createRetryUploader({
        retry: {
          retries: 3,
          backoff: 'linear',
          minDelayMs: 100,
        },
      });
      const file = createTestFile('test.png', 1024);
      
      const uploadPromise = uploader.upload(file).promise;
      
      await vi.runAllTimersAsync();
      
      await expect(uploadPromise).rejects.toThrow();
      
      // Linear backoff: 100, 200, 300
      expect(delays).toEqual([100, 200, 300]);
    });

    it('should use exponential backoff when configured', async () => {
      const delays: number[] = [];
      const originalSetTimeout = global.setTimeout;
      
      vi.spyOn(global, 'setTimeout').mockImplementation((callback, delay) => {
        if (typeof delay === 'number' && delay > 0) {
          delays.push(delay);
        }
        return originalSetTimeout(callback, 0);
      });
      
      server.use(
        http.put('https://test-bucket.s3.amazonaws.com/test-key', () => {
          return HttpResponse.json(
            { error: 'Server error' },
            { status: 500 }
          );
        })
      );
      
      const uploader = createRetryUploader({
        retry: {
          retries: 3,
          backoff: 'exponential',
          minDelayMs: 100,
          maxDelayMs: 1000,
        },
      });
      const file = createTestFile('test.png', 1024);
      
      const uploadPromise = uploader.upload(file).promise;
      
      await vi.runAllTimersAsync();
      
      await expect(uploadPromise).rejects.toThrow();
      
      // Exponential backoff: 100, 200, 400 (capped at maxDelayMs)
      expect(delays).toEqual([100, 200, 400]);
    });
  });

  describe('Abort Functionality', () => {
    it('should abort upload using cancel function', async () => {
      vi.useRealTimers(); // Use real timers for abort tests
      
      const uploader = createRetryUploader();
      const file = createTestFile('test.png', 1024);
      
      const { promise, cancel } = uploader.upload(file);
      
      // Cancel immediately
      cancel();
      
      await expect(promise).rejects.toThrow('Upload was aborted');
      await expect(promise).rejects.toMatchObject({
        code: 'ABORTED',
        phase: 'upload',
      });
      
      vi.useFakeTimers(); // Restore fake timers
    });

    it('should abort upload using AbortSignal', async () => {
      vi.useRealTimers(); // Use real timers for abort tests
      
      const uploader = createRetryUploader();
      const file = createTestFile('test.png', 1024);
      const abortController = new AbortController();
      
      const { promise } = uploader.upload(file, {
        signal: abortController.signal,
      });
      
      // Abort after short delay
      setTimeout(() => abortController.abort(), 10);
      
      await expect(promise).rejects.toThrow('Upload was aborted');
      
      vi.useFakeTimers(); // Restore fake timers
    });

    it('should not retry after abort', async () => {
      vi.useRealTimers(); // Use real timers for abort tests
      
      let attemptCount = 0;
      
      server.use(
        http.put('https://test-bucket.s3.amazonaws.com/test-key', () => {
          attemptCount++;
          return HttpResponse.json(
            { error: 'Server error' },
            { status: 500 }
          );
        })
      );
      
      const uploader = createRetryUploader();
      const file = createTestFile('test.png', 1024);
      
      const { promise, cancel } = uploader.upload(file);
      
      // Cancel after first attempt
      setTimeout(() => cancel(), 50);
      
      await expect(promise).rejects.toThrow('Upload was aborted');
      expect(attemptCount).toBe(1); // Should not retry after abort
      
      vi.useFakeTimers(); // Restore fake timers
    });
  });

  describe('Init Error Retry', () => {
    it('should retry init on server error', async () => {
      let initAttempts = 0;
      
      server.use(
        http.post('/api/upload/init', () => {
          initAttempts++;
          if (initAttempts <= 2) {
            return HttpResponse.json(
              { error: 'Init server error' },
              { status: 500 }
            );
          }
          return HttpResponse.json({
            mode: 'put',
            uploadUrl: 'https://test-bucket.s3.amazonaws.com/test-key',
            key: 'test-key',
          });
        })
      );
      
      const uploader = createRetryUploader();
      const file = createTestFile('test.png', 1024);
      
      const uploadPromise = uploader.upload(file).promise;
      
      await vi.runAllTimersAsync();
      
      const result = await uploadPromise;
      expect(result.key).toBe('test-key');
      expect(initAttempts).toBe(3);
    });
  });
});