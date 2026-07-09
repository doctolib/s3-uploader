# Secure Log Uploader

Client-side JavaScript application for uploading log bundles directly to S3 using a
presigned URL. No AWS credentials are handled in the browser.

## Features

- **Presigned URL upload**: the browser does a single HTTP `PUT` to a short-lived
  presigned URL. It never sees AWS access keys.
- **Real-time Progress**: progress bar with upload speed and ETA
- **Drag & Drop**: easy file selection
- **Server-side encryption**: the bucket's default SSE-KMS applies automatically, so
  the object always lands encrypted without the client sending any header.
- **Responsive Design**: works on desktop and mobile

## How it works

1. The page is served behind Cloudflare Access (SSO + device posture for internal
   users, one-time PIN for external practitioners).
2. On load, the page calls the broker (`GET /api/upload-url`), which validates the
   authenticated identity and returns a short-lived presigned `PUT` URL scoped to a
   single object key.
3. The browser `PUT`s the file straight to S3. No credentials, no backend upload hop,
   no file on a support agent's machine.

For staging tests you can skip the broker and paste a presigned URL into the field
(generate one with a `generate_presigned_url` PUT helper).

## Setup

### CORS on the bucket

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["PUT"],
        "AllowedOrigins": ["https://your-uploader-domain"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3000
    }
]
```

Set `AllowedOrigins` to the real uploader domain (behind Access), not `*`.

### Broker

The broker mints the presigned URL after Cloudflare Access has authenticated the
caller. It holds the AWS role permitted to `s3:PutObject` on the bucket; the browser
holds nothing.

## Notes

- Single `PUT` supports objects up to 5 GB, which covers log bundles. Multipart and
  resume were removed along with the credential-based flow.
- To require callers to prove they requested KMS, sign the URL with
  `ServerSideEncryption: aws:kms` and have the client replay the
  `x-amz-server-side-encryption` header. The default-encryption path above avoids
  this and is the recommended setup.

## Browser Compatibility

- Chrome 60+, Firefox 60+, Safari 12+, Edge 79+
