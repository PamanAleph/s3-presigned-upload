# @pamanaleph/s3-presigned-upload

🚀 **Single-Trigger S3 Presigned Upload Library** - Simplified S3 uploads using presigned URLs with automatic flow, progress tracking, retry logic, and multi-file support.

## ✨ Features

- **🔄 Automatic Flow**: `init → upload (PUT/POST) → progress → retry → result`
- **📊 Progress Tracking**: Real-time upload progress with throttling
- **🔁 Smart Retry**: Configurable retry with exponential/linear backoff
- **❌ Cancel/Abort**: Support for `cancel()` and `AbortSignal`
- **📁 Multi-File Upload**: Concurrent uploads with overall progress
- **🌐 SSR-Safe**: No `window` access on import
- **📦 ESM Ready**: Modern ES modules with TypeScript declarations
- **🎯 Lightweight**: Zero heavy dependencies, browser-focused

## 📦 Installation

```bash
npm install @pamanaleph/s3-presigned-upload
# or
pnpm add @pamanaleph/s3-presigned-upload
# or
yarn add @pamanaleph/s3-presigned-upload
```

## 🚀 Quick Start

```typescript
import { createUploader } from '@pamanaleph/s3-presigned-upload';

const uploader = createUploader({
  init: {
    url: '/api/upload/init',
    method: 'POST',
    headers: () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` }),
    buildPayload: ({ file }) => ({ 
      filename: file.name, 
      size: file.size, 
      type: file.type 
    }),
    mapResponse: (res) => res.mode === 'post'
      ? ({ mode: 'post', uploadUrl: res.url, key: res.key, fields: res.fields })
      : ({ mode: 'put', uploadUrl: res.url, key: res.key, headers: res.headers }),
  },
  retry: { 
    retries: 3, 
    backoff: 'exponential', 
    reinitOnAuthError: true 
  },
  transport: 'xhr',
});

// Single file upload with progress
const { promise, cancel } = uploader.upload(file, {
  onProgress: (p) => console.log(`${p.percent}% uploaded`),
});

const result = await promise;
console.log('Upload completed:', result);
```

## 📖 API Reference

### `createUploader(config: UploaderConfig): Uploader`

Creates a new uploader instance with the specified configuration.

#### UploaderConfig

```typescript
type UploaderConfig = {
  init: {
    url: string;                             // Backend init endpoint
    method?: 'POST' | 'GET';                 // Default: 'POST'
    headers?: HeadersInit | (() => HeadersInit);
    buildPayload?: (ctx: { file: File }) => any;
    mapResponse: (res: any) => PresignPut | PresignPost; // Normalize response
  };
  retry?: {
    retries?: number;                        // Default: 0
    backoff?: 'linear' | 'exponential';      // Default: 'exponential'
    minDelayMs?: number;                     // Default: 500
    maxDelayMs?: number;                     // Default: 4000
    reinitOnAuthError?: boolean;             // Default: true (403/expired)
  };
  transport?: 'xhr' | 'fetch';               // Default: 'xhr' (for progress)
  progressIntervalMs?: number;               // Default: 120ms
};
```

#### Presigned URL Types

```typescript
// For presigned PUT uploads
type PresignPut = {
  mode: 'put';
  uploadUrl: string;                         // Presigned PUT URL
  key: string;                               // S3 object key
  headers?: Record<string, string>;          // e.g. { "Content-Type": "image/png" }
  expiresAt?: number;                        // Epoch ms (optional)
};

// For presigned POST policy uploads
type PresignPost = {
  mode: 'post';
  uploadUrl: string;                         // https://<bucket>.s3.amazonaws.com
  key: string;
  fields: Record<string, string>;            // Policy, signature, credentials, etc.
  postFileFieldName?: string;                // Default: "file"
  expiresAt?: number;
};
```

### Uploader Methods

#### `upload(file: File, options?): { promise: Promise<UploadResult>, cancel: () => void }`

Uploads a single file.

```typescript
const { promise, cancel } = uploader.upload(file, {
  onProgress: (progress) => {
    console.log(`${progress.percent}% (${progress.bytesSent}/${progress.totalBytes})`);
  },
  signal: abortController.signal, // Optional AbortSignal
});

// Cancel upload
cancel();

// Or use AbortController
abortController.abort();
```

#### `uploadMany(files: File[], options?): Promise<{ results: PromiseSettledResult<UploadResult>[] }>`

Uploads multiple files concurrently.

```typescript
const result = await uploader.uploadMany(files, {
  concurrency: 3,                            // Default: 3
  onEachProgress: (index, progress) => {
    console.log(`File ${index}: ${progress.percent}%`);
  },
  onOverallProgress: (progress) => {
    console.log(`Overall: ${progress.percent}%`);
  },
  signal: abortController.signal,
});

// Check results
result.results.forEach((settledResult, index) => {
  if (settledResult.status === 'fulfilled') {
    console.log(`File ${index} uploaded:`, settledResult.value);
  } else {
    console.error(`File ${index} failed:`, settledResult.reason);
  }
});
```

### Types

```typescript
type UploadProgress = {
  bytesSent: number;
  totalBytes: number;
  percent: number;
};

type UploadResult = {
  key: string;
  location?: string;
  etag?: string;
  mode: 'put' | 'post';
};

type UploadError = Error & {
  name: 'UploadError';
  phase: 'init' | 'upload';
  code: 'NETWORK' | 'TIMEOUT' | 'EXPIRED' | 'ABORTED' | 'BAD_REQUEST' | 'SERVER';
  status?: number;
  detail?: unknown;
};
```

## 🔧 Configuration Examples

### Presigned PUT Upload

```typescript
const uploader = createUploader({
  init: {
    url: '/api/upload/init',
    buildPayload: ({ file }) => ({
      filename: file.name,
      contentType: file.type,
    }),
    mapResponse: (res) => ({
      mode: 'put',
      uploadUrl: res.presignedUrl,
      key: res.objectKey,
      headers: {
        'Content-Type': file.type,
        'x-amz-meta-user': 'user-123',
      },
    }),
  },
});
```

### Presigned POST Policy Upload

```typescript
const uploader = createUploader({
  init: {
    url: '/api/upload/init',
    buildPayload: ({ file }) => ({
      filename: file.name,
      size: file.size,
    }),
    mapResponse: (res) => ({
      mode: 'post',
      uploadUrl: res.formAction,
      key: res.key,
      fields: res.formFields, // Policy, signature, etc.
      postFileFieldName: 'file',
    }),
  },
});
```

### Dynamic Headers with Authentication

```typescript
const uploader = createUploader({
  init: {
    url: '/api/upload/init',
    headers: () => ({
      'Authorization': `Bearer ${getAuthToken()}`,
      'X-User-ID': getCurrentUserId(),
    }),
    mapResponse: (res) => res,
  },
});
```

### Custom Retry Configuration

```typescript
const uploader = createUploader({
  init: { /* ... */ },
  retry: {
    retries: 5,
    backoff: 'linear',
    minDelayMs: 1000,
    maxDelayMs: 10000,
    reinitOnAuthError: true, // Re-init on 403 errors
  },
});
```

## 🎯 Usage Patterns

### With React Hook

```typescript
import { useState, useCallback } from 'react';
import { createUploader } from '@pamanaleph/s3-presigned-upload';

function useFileUpload() {
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  
  const uploader = createUploader({
    init: {
      url: '/api/upload/init',
      headers: () => ({ Authorization: `Bearer ${getToken()}` }),
      mapResponse: (res) => res,
    },
    retry: { retries: 3 },
  });
  
  const upload = useCallback(async (file: File) => {
    setUploading(true);
    setProgress(0);
    
    try {
      const { promise } = uploader.upload(file, {
        onProgress: (p) => setProgress(p.percent),
      });
      
      const result = await promise;
      return result;
    } finally {
      setUploading(false);
    }
  }, []);
  
  return { upload, progress, uploading };
}
```

### Drag & Drop Multi-Upload

```typescript
const handleDrop = async (files: FileList) => {
  const fileArray = Array.from(files);
  
  const result = await uploader.uploadMany(fileArray, {
    concurrency: 2,
    onOverallProgress: (progress) => {
      updateProgressBar(progress.percent);
    },
    onEachProgress: (index, progress) => {
      updateFileProgress(index, progress.percent);
    },
  });
  
  // Handle results
  const successful = result.results.filter(r => r.status === 'fulfilled');
  const failed = result.results.filter(r => r.status === 'rejected');
  
  console.log(`${successful.length} uploaded, ${failed.length} failed`);
};
```

## ❓ FAQ

### Q: How to handle 403 expired errors?

**A:** Enable `reinitOnAuthError: true` in retry config. The library will automatically re-initialize and retry the upload when encountering 403 errors.

```typescript
const uploader = createUploader({
  init: { /* ... */ },
  retry: {
    retries: 3,
    reinitOnAuthError: true, // Auto re-init on 403
  },
});
```

### Q: How to configure CORS for S3?

**A:** Your S3 bucket needs proper CORS configuration:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "POST"],
    "AllowedOrigins": ["https://yourdomain.com"],
    "ExposeHeaders": ["ETag"]
  }
]
```

### Q: PUT vs POST - which should I use?

**A:**
- **PUT**: Simpler, direct upload to presigned URL. Good for most cases.
- **POST**: More secure, uses policy-based uploads. Required for complex scenarios.

### Q: How to get ETag from upload result?

**A:** ETag is automatically extracted from S3 response headers:

```typescript
const result = await promise;
console.log('ETag:', result.etag); // Available for PUT uploads
```

### Q: Can I use this in Node.js?

**A:** This library is designed for browsers. For Node.js, consider using the AWS SDK directly.

### Q: How to handle large files?

**A:** The library handles files of any size, but for very large files (>100MB), consider:
- Using presigned POST with size limits
- Implementing multipart upload (not included in this library)
- Setting appropriate timeout values

## 🔒 Security Considerations

- Always validate file types and sizes on your backend
- Use presigned URLs with appropriate expiration times
- Implement proper authentication for init endpoints
- Consider using POST policy for additional security constraints
- Never expose AWS credentials in frontend code

## 🤝 Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our repository.

## 📄 License

MIT License - see LICENSE file for details.

## 🔗 Links

- [GitHub Repository](https://github.com/pamanaleph/s3-presigned-upload)
- [NPM Package](https://www.npmjs.com/package/@pamanaleph/s3-presigned-upload)
- [Issues & Bug Reports](https://github.com/pamanaleph/s3-presigned-upload/issues)