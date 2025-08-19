/**
 * Tests for mapResponse validation and multi-file upload
 */

import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { createUploader, UploadError } from '../src/index.js';
import { createTestFile, server } from './setup.js';
import type { UploaderConfig, UploadProgress } from '../src/types.js';

describe('MapResponse Validation', () => {
  const createTestUploader = (mapResponse: (res: any) => any) => {
    return createUploader({
      init: {
        url: '/api/upload/init',
        method: 'POST',
        buildPayload: ({ file }) => ({ filename: file.name }),
        mapResponse,
      },
      transport: 'xhr',
    });
  };

  it('should handle valid PUT response mapping', async () => {
    const mapResponse = vi.fn((res) => ({
      mode: 'put' as const,
      uploadUrl: res.uploadUrl,
      key: res.key,
      headers: res.headers,
      expiresAt: res.expiresAt,
    }));
    
    const uploader = createTestUploader(mapResponse);
    const file = createTestFile('test.png', 1024);
    
    const { promise } = uploader.upload(file);
    const result = await promise;
    
    expect(mapResponse).toHaveBeenCalledWith({
      mode: 'put',
      uploadUrl: 'https://test-bucket.s3.amazonaws.com/test-key?X-Amz-Signature=test',
      key: 'test-key',
      headers: { 'Content-Type': 'image/png' },
      expiresAt: expect.any(Number),
    });
    
    expect(result.mode).toBe('put');
    expect(result.key).toBe('test-key');
  });

  it('should handle valid POST response mapping', async () => {
    const mapResponse = vi.fn((res) => ({
      mode: 'post' as const,
      uploadUrl: res.uploadUrl,
      key: res.key,
      fields: res.fields,
      postFileFieldName: res.postFileFieldName,
    }));
    
    const uploader = createUploader({
      init: {
        url: '/api/upload/init-post',
        method: 'POST',
        buildPayload: ({ file }) => ({ filename: file.name }),
        mapResponse,
      },
      transport: 'xhr',
    });
    
    const file = createTestFile('test.png', 1024);
    
    const { promise } = uploader.upload(file);
    const result = await promise;
    
    expect(mapResponse).toHaveBeenCalled();
    expect(result.mode).toBe('post');
    expect(result.key).toBe('test-key-post');
  });

  it('should handle complex response transformation', async () => {
    server.use(
      http.post('/api/upload/init', () => {
        return HttpResponse.json({
          data: {
            upload: {
              type: 'PUT',
              url: 'https://test-bucket.s3.amazonaws.com/nested-key',
              objectKey: 'nested-key',
              requestHeaders: {
                'Content-Type': 'application/octet-stream',
                'x-amz-meta-user': 'test-user',
              },
            },
          },
          meta: {
            expiresAt: Date.now() + 3600000,
          },
        });
      })
    );
    
    const mapResponse = (res: any) => ({
      mode: 'put' as const,
      uploadUrl: res.data.upload.url,
      key: res.data.upload.objectKey,
      headers: res.data.upload.requestHeaders,
      expiresAt: res.meta.expiresAt,
    });
    
    const uploader = createTestUploader(mapResponse);
    const file = createTestFile('test.bin', 1024, 'application/octet-stream');
    
    const { promise } = uploader.upload(file);
    const result = await promise;
    
    expect(result.mode).toBe('put');
    expect(result.key).toBe('nested-key');
  });

  it('should handle mapResponse errors gracefully', async () => {
    const mapResponse = () => {
      throw new Error('Mapping failed');
    };
    
    const uploader = createTestUploader(mapResponse);
    const file = createTestFile('test.png', 1024);
    
    const { promise } = uploader.upload(file);
    
    await expect(promise).rejects.toThrow(UploadError);
    await expect(promise).rejects.toMatchObject({
      phase: 'init',
      code: 'NETWORK',
    });
  });

  it('should validate required fields in mapped response', async () => {
    const mapResponse = () => ({
      // Missing required fields
      mode: 'put',
      // uploadUrl: missing
      // key: missing
    });
    
    const uploader = createTestUploader(mapResponse);
    const file = createTestFile('test.png', 1024);
    
    const { promise } = uploader.upload(file);
    
    // Should fail during upload phase when trying to use invalid config
    await expect(promise).rejects.toThrow();
  });
});

describe('Multi-File Upload', () => {
  const createMultiUploader = (overrides: Partial<UploaderConfig> = {}) => {
    return createUploader({
      init: {
        url: '/api/upload/init',
        method: 'POST',
        buildPayload: ({ file }) => ({ filename: file.name }),
        mapResponse: (res) => res,
      },
      transport: 'xhr',
      progressIntervalMs: 50,
      ...overrides,
    });
  };

  it('should upload multiple files successfully', async () => {
    const uploader = createMultiUploader();
    const files = [
      createTestFile('file1.png', 1024),
      createTestFile('file2.jpg', 2048),
      createTestFile('file3.pdf', 512),
    ];
    
    const result = await uploader.uploadMany(files);
    
    expect(result.results).toHaveLength(3);
    result.results.forEach((settledResult) => {
      expect(settledResult.status).toBe('fulfilled');
      if (settledResult.status === 'fulfilled') {
        expect(settledResult.value.mode).toBe('put');
        expect(settledResult.value.key).toBe('test-key');
      }
    });
  });

  it('should track individual file progress', async () => {
    const uploader = createMultiUploader();
    const files = [
      createTestFile('file1.png', 1024),
      createTestFile('file2.jpg', 2048),
    ];
    
    const progressEvents: Array<{ index: number; progress: UploadProgress }> = [];
    const onEachProgress = vi.fn((index: number, progress: UploadProgress) => {
      progressEvents.push({ index, progress });
    });
    
    await uploader.uploadMany(files, { onEachProgress });
    
    expect(onEachProgress).toHaveBeenCalled();
    expect(progressEvents.length).toBeGreaterThan(0);
    
    // Should have progress events for both files
    const file0Events = progressEvents.filter(e => e.index === 0);
    const file1Events = progressEvents.filter(e => e.index === 1);
    
    expect(file0Events.length).toBeGreaterThan(0);
    expect(file1Events.length).toBeGreaterThan(0);
  });

  it('should track overall progress', async () => {
    const uploader = createMultiUploader();
    const files = [
      createTestFile('file1.png', 1000),
      createTestFile('file2.jpg', 2000),
      createTestFile('file3.pdf', 3000),
    ];
    
    const overallProgressEvents: UploadProgress[] = [];
    const onOverallProgress = vi.fn((progress: UploadProgress) => {
      overallProgressEvents.push(progress);
    });
    
    await uploader.uploadMany(files, { onOverallProgress });
    
    expect(onOverallProgress).toHaveBeenCalled();
    expect(overallProgressEvents.length).toBeGreaterThan(0);
    
    // Last progress should be 100%
    const lastProgress = overallProgressEvents[overallProgressEvents.length - 1];
    expect(lastProgress?.percent).toBe(100);
    expect(lastProgress?.totalBytes).toBe(6000); // Sum of all file sizes
    expect(lastProgress?.bytesSent).toBe(6000);
  });

  it('should respect concurrency limit', async () => {
    let concurrentUploads = 0;
    let maxConcurrentUploads = 0;
    
    // Mock to track concurrent uploads
    server.use(
      http.put('https://test-bucket.s3.amazonaws.com/test-key', async () => {
        concurrentUploads++;
        maxConcurrentUploads = Math.max(maxConcurrentUploads, concurrentUploads);
        
        // Simulate upload time
        await new Promise(resolve => setTimeout(resolve, 100));
        
        concurrentUploads--;
        
        return new HttpResponse(null, {
          status: 200,
          headers: { 'ETag': '"test"' },
        });
      })
    );
    
    const uploader = createMultiUploader();
    const files = Array.from({ length: 10 }, (_, i) => 
      createTestFile(`file${i}.png`, 1024)
    );
    
    await uploader.uploadMany(files, { concurrency: 3 });
    
    expect(maxConcurrentUploads).toBeLessThanOrEqual(3);
  });

  it('should handle mixed success and failure results', async () => {
    let uploadCount = 0;
    
    server.use(
      http.put('https://test-bucket.s3.amazonaws.com/test-key', () => {
        uploadCount++;
        
        // Fail every other upload
        if (uploadCount % 2 === 0) {
          return HttpResponse.json(
            { error: 'Upload failed' },
            { status: 500 }
          );
        }
        
        return new HttpResponse(null, {
          status: 200,
          headers: { 'ETag': '"success"' },
        });
      })
    );
    
    const uploader = createMultiUploader();
    const files = [
      createTestFile('file1.png', 1024), // Should succeed
      createTestFile('file2.png', 1024), // Should fail
      createTestFile('file3.png', 1024), // Should succeed
      createTestFile('file4.png', 1024), // Should fail
    ];
    
    const result = await uploader.uploadMany(files);
    
    expect(result.results).toHaveLength(4);
    expect(result.results[0]?.status).toBe('fulfilled');
    expect(result.results[1]?.status).toBe('rejected');
    expect(result.results[2]?.status).toBe('fulfilled');
    expect(result.results[3]?.status).toBe('rejected');
  });

  it('should support aborting multi-file upload', async () => {
    const uploader = createMultiUploader();
    const files = Array.from({ length: 5 }, (_, i) => 
      createTestFile(`file${i}.png`, 1024)
    );
    
    const abortController = new AbortController();
    
    const uploadPromise = uploader.uploadMany(files, {
      signal: abortController.signal,
    });
    
    // Abort after short delay
    setTimeout(() => abortController.abort(), 50);
    
    const result = await uploadPromise;
    
    // Some uploads may have completed, others should be rejected
    const rejectedResults = result.results.filter(r => r.status === 'rejected');
    expect(rejectedResults.length).toBeGreaterThan(0);
  });

  it('should handle empty file array', async () => {
    const uploader = createMultiUploader();
    
    const result = await uploader.uploadMany([]);
    
    expect(result.results).toHaveLength(0);
  });

  it('should handle single file in uploadMany', async () => {
    const uploader = createMultiUploader();
    const files = [createTestFile('single.png', 1024)];
    
    const result = await uploader.uploadMany(files);
    
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe('fulfilled');
  });

  it('should work with different transport types', async () => {
    const xhrUploader = createMultiUploader({ transport: 'xhr' });
    const fetchUploader = createMultiUploader({ transport: 'fetch' });
    
    const files = [
      createTestFile('xhr-file.png', 1024),
      createTestFile('fetch-file.png', 1024),
    ];
    
    const [xhrResult, fetchResult] = await Promise.all([
      xhrUploader.uploadMany([files[0]!]),
      fetchUploader.uploadMany([files[1]!]),
    ]);
    
    expect(xhrResult.results[0]?.status).toBe('fulfilled');
    expect(fetchResult.results[0]?.status).toBe('fulfilled');
  });
});