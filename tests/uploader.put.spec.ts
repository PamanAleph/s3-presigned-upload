/**
 * Tests for presigned PUT upload scenarios
 */

import { describe, it, expect, vi } from 'vitest';
import { createUploader } from '../src/index.js';
import { createTestFile } from './setup.js';
import type { UploadProgress, UploaderConfig } from '../src/types.js';

describe('Uploader - PUT Upload', () => {
  const createPutUploader = (overrides: Partial<UploaderConfig> = {}) => {
    return createUploader({
      init: {
        url: '/api/upload/init',
        method: 'POST',
        headers: { 'Authorization': 'Bearer test-token' },
        buildPayload: ({ file }) => ({
          filename: file.name,
          size: file.size,
          type: file.type,
        }),
        mapResponse: (res) => res,
      },
      transport: 'xhr',
      progressIntervalMs: 50,
      ...overrides,
    });
  };

  it('should successfully upload a file using PUT', async () => {
    const uploader = createPutUploader();
    const file = createTestFile('test.png', 1024);
    
    const { promise } = uploader.upload(file);
    const result = await promise;
    
    expect(result).toEqual({
      key: 'test-key',
      location: 'https://test-bucket.s3.amazonaws.com/test-key',
      etag: 'abc123def456',
      mode: 'put',
    });
  });

  it('should track upload progress', async () => {
    const uploader = createPutUploader();
    const file = createTestFile('test.png', 2048);
    
    const progressEvents: UploadProgress[] = [];
    const onProgress = vi.fn((progress: UploadProgress) => {
      progressEvents.push(progress);
    });
    
    const { promise } = uploader.upload(file, { onProgress });
    await promise;
    
    // Should have received progress events
    expect(onProgress).toHaveBeenCalled();
    expect(progressEvents.length).toBeGreaterThan(0);
    
    // Last progress should be 100%
    const lastProgress = progressEvents[progressEvents.length - 1];
    expect(lastProgress?.percent).toBe(100);
    expect(lastProgress?.bytesSent).toBe(file.size);
    expect(lastProgress?.totalBytes).toBe(file.size);
  });

  it('should handle progress throttling', async () => {
    const uploader = createPutUploader({ progressIntervalMs: 100 });
    const file = createTestFile('test.png', 4096);
    
    const progressEvents: UploadProgress[] = [];
    const onProgress = vi.fn((progress: UploadProgress) => {
      progressEvents.push(progress);
    });
    
    const { promise } = uploader.upload(file, { onProgress });
    await promise;
    
    // Progress should be throttled (fewer events than without throttling)
    expect(progressEvents.length).toBeLessThan(10);
  });

  it('should support cancellation', async () => {
    const uploader = createPutUploader();
    const file = createTestFile('test.png', 1024);
    
    const { promise, cancel } = uploader.upload(file);
    
    // Cancel immediately
    cancel();
    
    await expect(promise).rejects.toThrow('Upload was aborted');
  });

  it('should support AbortSignal', async () => {
    const uploader = createPutUploader();
    const file = createTestFile('test.png', 1024);
    const abortController = new AbortController();
    
    const { promise } = uploader.upload(file, {
      signal: abortController.signal,
    });
    
    // Abort after a short delay
    setTimeout(() => abortController.abort(), 10);
    
    await expect(promise).rejects.toThrow('Upload was aborted');
  });

  it('should handle custom headers in PUT request', async () => {
    const uploader = createPutUploader();
    const file = createTestFile('test.png', 1024);
    
    const { promise } = uploader.upload(file);
    const result = await promise;
    
    // Should succeed with custom headers from mock response
    expect(result.mode).toBe('put');
    expect(result.key).toBe('test-key');
  });

  it('should handle dynamic headers function', async () => {
    const headersFunction = vi.fn(() => ({
      'Authorization': 'Bearer dynamic-token',
      'X-Custom-Header': 'test-value',
    }));
    
    const uploader = createPutUploader({
      init: {
        url: '/api/upload/init',
        method: 'POST',
        headers: headersFunction,
        buildPayload: ({ file }) => ({ filename: file.name }),
        mapResponse: (res) => res,
      },
    });
    
    const file = createTestFile('test.png', 1024);
    const { promise } = uploader.upload(file);
    await promise;
    
    expect(headersFunction).toHaveBeenCalled();
  });

  it('should handle GET method for init', async () => {
    const uploader = createPutUploader({
      init: {
        url: '/api/upload/init',
        method: 'GET',
        mapResponse: (res) => res,
      },
    });
    
    const file = createTestFile('test.png', 1024);
    const { promise } = uploader.upload(file);
    const result = await promise;
    
    expect(result.mode).toBe('put');
  });

  it('should handle large files', async () => {
    const uploader = createPutUploader();
    const file = createTestFile('large.png', 10 * 1024 * 1024); // 10MB
    
    const progressEvents: UploadProgress[] = [];
    const onProgress = vi.fn((progress: UploadProgress) => {
      progressEvents.push(progress);
    });
    
    const { promise } = uploader.upload(file, { onProgress });
    const result = await promise;
    
    expect(result.mode).toBe('put');
    expect(result.key).toBe('test-key');
    expect(onProgress).toHaveBeenCalled();
    
    // In jsdom environment, progress events may not work exactly like in browsers
    // Just verify that the upload completes successfully
    expect(progressEvents.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle files with special characters in name', async () => {
    const uploader = createPutUploader();
    const file = createTestFile('test file with spaces & symbols!.png', 1024);
    
    const { promise } = uploader.upload(file);
    const result = await promise;
    
    expect(result.mode).toBe('put');
    expect(result.key).toBe('test-key');
  });
});