# S3 Uploader

Client-side JavaScript application for uploading files to S3. Two modes, chosen with a
toggle:

- **AWS credentials** (default): the original multipart flow (with resume), for
  operators with direct S3 access.
- **Presigned URL**: paste a short-lived presigned `PUT` URL (however you obtained
  it) and the browser does a single `PUT` to it. No AWS credentials are handled in
  the browser.

## Features

- **Presigned URL upload**: single `PUT`, no credentials, no SDK on the request path
- **Credentialed multipart upload**: 100 MB chunks, resume of interrupted uploads
- **Real-time Progress**: progress bar with upload speed and ETA
- **Drag & Drop**: easy file selection
- **Server-side encryption**: on a bucket with default SSE-KMS, objects land encrypted
  without the client sending any header
- **Responsive Design**: works on desktop and mobile

## How it works

### Presigned URL mode

Paste a presigned `PUT` URL into the field. The browser then does a single `PUT`
straight to that URL — no credentials, no backend upload hop, no AWS SDK. Getting a
presigned URL in the first place (minting it, authenticating the request for it,
scoping it to a bucket/key) is outside this repo.

### Credential mode

Enter an AWS access key, secret key, and bucket. The AWS SDK runs a multipart upload
directly from the browser, with resume support for interrupted transfers. Use this only
where handing the operator direct S3 access is acceptable.

## Setup

### CORS on the bucket

```json
[
    {
        "AllowedHeaders": ["*"],
        "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
        "AllowedOrigins": ["https://your-uploader-domain"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3000
    }
]
```

Set `AllowedOrigins` to your uploader's real domain, not `*`. Presigned mode only
ever needs `PUT`. Credential mode's multipart flow needs the rest: `POST` to create
and complete the upload, `GET` for `ListParts` (resume), `DELETE` for
`AbortMultipartUpload` (cleanup on failure).

## Notes

- Single `PUT` (presigned mode) supports objects up to 5 GB. The client rejects
  larger files up front; there is no multipart or resume support in this mode.
- The presigned URL target is validated against an AWS S3 host allowlist before any
  upload, so a pasted or tampered URL cannot redirect the file elsewhere.
- To require callers to prove they requested KMS, sign the URL with
  `ServerSideEncryption: aws:kms` and have the client replay the
  `x-amz-server-side-encryption` header. The default-encryption path avoids this and is
  the recommended setup.

## Browser Compatibility

- Chrome 60+, Firefox 60+, Safari 12+, Edge 79+
