/**
 * Test setup for Vitest with MSW (Mock Service Worker)
 */

import { beforeAll, afterEach, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// Mock responses for testing
const mockPutResponse = {
  mode: 'put',
  uploadUrl: 'https://test-bucket.s3.amazonaws.com/test-key?X-Amz-Signature=test',
  key: 'test-key',
  headers: {
    'Content-Type': 'image/png',
  },
  expiresAt: Date.now() + 3600000, // 1 hour from now
};

const mockPostResponse = {
  mode: 'post',
  uploadUrl: 'https://test-bucket.s3.amazonaws.com',
  key: 'test-key-post',
  fields: {
    'key': 'test-key-post',
    'bucket': 'test-bucket',
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': 'test-credential',
    'X-Amz-Date': '20231201T000000Z',
    'Policy': 'test-policy',
    'X-Amz-Signature': 'test-signature',
  },
  postFileFieldName: 'file',
  expiresAt: Date.now() + 3600000,
};

// Create MSW server with handlers
export const server = setupServer(
  // Mock init endpoint - PUT response
  http.post('/api/upload/init', () => {
    return HttpResponse.json(mockPutResponse);
  }),
  
  // Mock init endpoint - POST response
  http.post('/api/upload/init-post', () => {
    return HttpResponse.json(mockPostResponse);
  }),
  
  // Mock init endpoint - error response
  http.post('/api/upload/init-error', () => {
    return HttpResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  }),
  
  // Mock init endpoint - server error
  http.post('/api/upload/init-server-error', () => {
    return HttpResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }),
  
  // Mock init endpoint - expired/auth error
  http.post('/api/upload/init-expired', () => {
    return HttpResponse.json(
      { error: 'Token expired' },
      { status: 403 }
    );
  }),
  
  // Mock S3 PUT upload - success
  http.put('https://test-bucket.s3.amazonaws.com/test-key', () => {
    return new HttpResponse(null, {
      status: 200,
      headers: {
        'ETag': '"abc123def456"',
        'Location': 'https://test-bucket.s3.amazonaws.com/test-key',
      },
    });
  }),
  
  // Mock S3 POST upload - success
  http.post('https://test-bucket.s3.amazonaws.com', () => {
    return new HttpResponse(null, {
      status: 204,
      headers: {
        'Location': 'https://test-bucket.s3.amazonaws.com/test-key-post',
      },
    });
  }),
  
  // Mock S3 upload - server error
  http.put('https://test-bucket.s3.amazonaws.com/error-key', () => {
    return HttpResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    );
  }),
  
  // Mock S3 upload - expired
  http.put('https://test-bucket.s3.amazonaws.com/expired-key', () => {
    return HttpResponse.json(
      { error: 'Request has expired' },
      { status: 403 }
    );
  })
);

// Setup MSW
beforeAll(() => {
  server.listen({ onUnhandledRequest: 'warn' });
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

// Export mock data for use in tests
export { mockPutResponse, mockPostResponse };

// Helper function to create test files
export function createTestFile(
  name: string = 'test.png',
  size: number = 1024,
  type: string = 'image/png'
): File {
  const content = new Uint8Array(size).fill(65); // Fill with 'A' characters
  return new File([content], name, { type });
}

// Helper function to wait for a condition
export function waitFor(
  condition: () => boolean,
  timeout: number = 5000,
  interval: number = 10
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const check = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('Timeout waiting for condition'));
      } else {
        setTimeout(check, interval);
      }
    };
    
    check();
  });
}