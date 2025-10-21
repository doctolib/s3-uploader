# S3 Multipart Uploader Web

Client-side JavaScript application for uploading files directly to S3 buckets using multipart upload with a modern web UI.

## Features

- **Client-side JavaScript**: Runs entirely in the browser, pushes files directly to S3
- **Multipart Upload**: Efficient upload for large files (100MB chunks)
- **Real-time Progress**: Progress bar with upload speed and ETA
- **Drag & Drop**: Easy file selection with drag and drop support  
- **Direct S3 Upload**: No backend server required - uploads straight from browser to bucket
- **Conditional Writes**: Prevents accidental overwrites using S3 conditional headers
- **Responsive Design**: Works on desktop and mobile devices
- **Error Handling**: Graceful permission and network error handling

## Usage

### 1. Setup CORS on your S3 bucket

Add this CORS configuration to your S3 bucket:

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": [
            "GET", 
            "PUT", 
            "POST", 
            "DELETE"
        ],
        "AllowedOrigins": ["https://your-domain.com"],
        "ExposeHeaders": [
            "ETag",
            "x-amz-request-id"
        ],
        "MaxAgeSeconds": 3000
    }
]
```

### 2. Serve the files

Serve the HTML files using any web server or open index.html directly in your browser.

### 3. Upload files

1. Enter your AWS credentials
2. Select region and bucket name  
3. Choose a file (or drag & drop)
4. Click "Start Upload"

## AWS Permissions

### Minimum Required
- `s3:PutObject` - Upload files (includes multipart operations)

### Recommended 
- `s3:PutObject` - Upload files
- `s3:AbortMultipartUpload` - Clean up failed uploads

### Example IAM Policy

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "s3:PutObject",
                "s3:AbortMultipartUpload"
            ],
            "Resource": "arn:aws:s3:::your-bucket-name/*"
        }
    ]
}
```

## How It Works

This is a pure client-side JavaScript application that uses the AWS SDK to upload files directly from the browser to your S3 bucket. The upload happens client-side without any backend server - your files go straight from your browser to S3.

## Browser Compatibility

- ✅ Chrome 60+
- ✅ Firefox 60+ 
- ✅ Safari 12+
- ✅ Edge 79+

Requires support for:
- File API
- Blob slicing
- Promises/async-await
- Drag & Drop API

## Technical Details

- **Language**: Pure JavaScript (no build process required)
- **AWS SDK**: Loaded from CDN, uses S3 Multipart Upload API
- **Part Size**: 100MB chunks for efficient large file handling
- **Concurrency**: 3 simultaneous part uploads
- **Progress Tracking**: Real-time with speed and ETA calculation
- **Direct Upload**: Files stream from browser directly to S3 bucket

