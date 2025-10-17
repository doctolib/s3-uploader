# S3 Multipart Uploader Web

Web-based version of the S3 multipart uploader with a modern UI.

## Features

- **Multipart Upload**: Efficient upload for large files (100MB chunks)
- **Real-time Progress**: Progress bar with upload speed and ETA
- **Drag & Drop**: Easy file selection with drag and drop support  
- **CORS Support**: Direct browser-to-S3 upload (no backend required)
- **Object Existence Check**: Warns before overwriting existing files
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
        "AllowedOrigins": ["*"],
        "ExposeHeaders": [
            "ETag",
            "x-amz-request-id"
        ],
        "MaxAgeSeconds": 3000
    }
]
```

### 2. Serve the files

You can serve the files using any web server:

```bash
# Python 3
python -m http.server 8000

# Node.js (if you have http-server installed)
npx http-server

# PHP
php -S localhost:8000
```

Then open http://localhost:8000 in your browser.

### 3. Upload files

1. Enter your AWS credentials
2. Select region and bucket name  
3. Choose a file (or drag & drop)
4. Click "Start Upload"

## AWS Permissions

### Minimum Required
- `s3:PutObject` - Upload files
- `s3:PutObjectAcl` - Set object permissions

### Recommended 
- `s3:PutObject` - Upload files
- `s3:ListBucket` - Check if objects exist
- `s3:PutObjectAcl` - Set object permissions
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
                "s3:PutObjectAcl",
                "s3:ListBucket",
                "s3:AbortMultipartUpload"
            ],
            "Resource": [
                "arn:aws:s3:::your-bucket-name",
                "arn:aws:s3:::your-bucket-name/*"
            ]
        }
    ]
}
```

## Security Considerations

⚠️ **Important**: This is a client-side application that requires AWS credentials in the browser. For production use:

1. **Use IAM roles with temporary credentials** (STS)
2. **Implement a backend** to generate presigned URLs
3. **Restrict IAM permissions** to minimum required
4. **Use specific CORS origins** instead of "*"

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

- **Part Size**: 100MB per part
- **Concurrency**: 3 simultaneous uploads
- **AWS SDK**: v2.1471.0 (loaded from CDN)
- **Upload Method**: S3 Multipart Upload API
- **Progress Tracking**: Real-time with speed and ETA calculation

## Differences from CLI version

| Feature | CLI Version | Web Version |
|---------|-------------|-------------|
| File size limit | Unlimited | ~2-4GB (browser memory) |
| Credentials | Interactive prompt | Form input |
| Progress display | Terminal output | Web progress bar |
| File selection | Path input | File picker + drag/drop |
| Error handling | Exit codes | User-friendly messages |
| CORS requirement | No | Yes (S3 bucket config) |