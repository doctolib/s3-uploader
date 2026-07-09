# Secure Log Uploader

Client-side JavaScript application for uploading files to S3. Two modes, chosen with a
toggle:

- **Presigned URL** (default): the browser does a single HTTP `PUT` to a short-lived
  presigned URL. No AWS credentials are handled in the browser. This is the mode used
  by Secure Log Collection.
- **AWS credentials**: the original multipart flow (with resume), kept for other use
  cases where the operator has direct S3 access.

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

1. The page is served behind Cloudflare Access (SSO + device posture for internal
   users, one-time PIN for external practitioners).
2. On load, the page calls the broker (`GET /api/upload-url`), which validates the
   authenticated identity and returns a short-lived presigned `PUT` URL scoped to a
   single object key.
3. The browser `PUT`s the file straight to S3. No credentials, no backend upload hop,
   no file on a support agent's machine.

For staging tests, skip the broker and paste a presigned URL into the field.

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
        "AllowedMethods": ["PUT", "POST"],
        "AllowedOrigins": ["https://your-uploader-domain"],
        "ExposeHeaders": ["ETag"],
        "MaxAgeSeconds": 3000
    }
]
```

Set `AllowedOrigins` to the real uploader domain (behind Access), not `*`. `POST` is
only needed for multipart (credential mode).

### Broker (presigned mode)

The broker mints the presigned URL after Cloudflare Access has authenticated the
caller. It holds the AWS role permitted to `s3:PutObject` on the bucket; the browser
holds nothing.

## Notes

- Single `PUT` (presigned mode) supports objects up to 5 GB, which covers log bundles.
  The client rejects larger files up front.
- The presigned URL target is validated against an AWS S3 host allowlist before any
  upload, so a pasted or tampered URL cannot redirect the file elsewhere.
- To require callers to prove they requested KMS, sign the URL with
  `ServerSideEncryption: aws:kms` and have the client replay the
  `x-amz-server-side-encryption` header. The default-encryption path avoids this and is
  the recommended setup.

### Broker contract

- `POST /api/upload-url` (not GET, so the response is not cacheable). Returns
  `{ "url": "https://<bucket>.s3.eu-central-1.amazonaws.com/..." }` and must send
  `Cache-Control: no-store`.
- Do **not** include `Content-Type` in the signed headers, or signatures will mismatch
  for some file types.

### Serving-layer hardening (follow-up, not in this repo)

- The AWS SDK still loads from a public CDN in credential mode (dynamic import, only
  when that mode is used). For a Tier 0 deployment, vendor the SDK into the served
  bundle and add a strict Content-Security-Policy (`script-src 'self'`,
  `connect-src 'self' https://<bucket>.s3.eu-central-1.amazonaws.com`).
- Ship a **practitioner-facing build with the presigned flow only** (no toggle, no
  credential inputs, no SDK). Keep the credential/multipart tool as a separate
  internal-only page behind SSO. Same repo is fine; same served bundle is not.

## Browser Compatibility

- Chrome 60+, Firefox 60+, Safari 12+, Edge 79+
