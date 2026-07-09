import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListPartsCommand } from 'https://cdn.skypack.dev/@aws-sdk/client-s3@3.637.0';

class S3Uploader {
    constructor() {
        this.partSize = 100 * 1024 * 1024; // Default 100MB, set from form in credential mode
        this.concurrency = 3;
        this.s3 = null;
        this.uploadId = null;
        this.parts = [];
        this.uploadedBytes = 0;
        this.startTime = null;
        this.file = null;
        this.config = {};
        this.resumeState = null;

        this.initializeUI();
        this.setupModeToggle();
        this.checkForResumeableUpload();
        this.setupBucketNameCleaning();
        this.fetchUploadUrl();
    }

    // Show credential fields or the presigned URL field depending on the toggle.
    // Fields hidden by the toggle are also emptied of the `required` obligation
    // in JS validation, so a hidden section never blocks form submission.
    setupModeToggle() {
        const toggle = document.getElementById('usePresigned');
        const presignedFields = document.getElementById('presignedFields');
        const credentialFields = document.getElementById('credentialFields');

        const apply = () => {
            const presigned = toggle.checked;
            presignedFields.style.display = presigned ? '' : 'none';
            credentialFields.style.display = presigned ? 'none' : '';
        };
        toggle.addEventListener('change', apply);
        apply();
    }

    // Presigned mode only: on load, ask the broker (behind Cloudflare Access)
    // for a short-lived presigned PUT URL so the browser never handles AWS
    // credentials. In staging the field can be filled manually instead.
    async fetchUploadUrl() {
        const field = document.getElementById('presignedUrl');
        const toggle = document.getElementById('usePresigned');
        if (!field || !toggle.checked || field.value.trim()) return;
        try {
            const res = await fetch('/api/upload-url', { credentials: 'include' });
            if (!res.ok) throw new Error(`broker returned HTTP ${res.status}`);
            const data = await res.json();
            field.value = data.url;
        } catch (e) {
            console.warn('Could not fetch upload URL from broker (paste one to test):', e.message);
        }
    }

    initializeUI() {
        const form = document.getElementById('uploadForm');
        const fileInput = document.getElementById('fileInput');
        const fileLabel = document.querySelector('.file-input-label');

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.startUpload();
        });

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                fileLabel.textContent = `📁 ${file.name} (${this.formatFileSize(file.size)})`;
                fileLabel.style.borderColor = '#e1e5e9';
                fileLabel.style.backgroundColor = '';

                if (this.resumeState && file.name === this.resumeState.fileName && file.size === this.resumeState.fileSize) {
                    fileLabel.innerHTML = `📁 ${file.name} (${this.formatFileSize(file.size)}) <span style="color: #28a745;">✅ Ready to resume</span>`;
                    fileLabel.style.borderColor = '#28a745';
                    fileLabel.style.backgroundColor = '#f8fff8';
                }
            }
        });

        fileLabel.addEventListener('dragover', (e) => {
            e.preventDefault();
            fileLabel.style.borderColor = '#667eea';
            fileLabel.style.backgroundColor = '#f8f9ff';
        });

        fileLabel.addEventListener('dragleave', (e) => {
            e.preventDefault();
            fileLabel.style.borderColor = '#e1e5e9';
            fileLabel.style.backgroundColor = '';
        });

        fileLabel.addEventListener('drop', (e) => {
            e.preventDefault();
            fileLabel.style.borderColor = '#e1e5e9';
            fileLabel.style.backgroundColor = '';

            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const dataTransfer = new DataTransfer();
                for (let i = 0; i < files.length; i++) {
                    dataTransfer.items.add(files[i]);
                }
                fileInput.files = dataTransfer.files;
                fileLabel.textContent = `📁 ${files[0].name} (${this.formatFileSize(files[0].size)})`;

                if (this.resumeState && files[0].name === this.resumeState.fileName && files[0].size === this.resumeState.fileSize) {
                    fileLabel.innerHTML = `📁 ${files[0].name} (${this.formatFileSize(files[0].size)}) <span style="color: #28a745;">✅ Ready to resume</span>`;
                    fileLabel.style.borderColor = '#28a745';
                    fileLabel.style.backgroundColor = '#f8fff8';
                }
            }
        });

        document.getElementById('cancelResume').addEventListener('click', () => {
            document.getElementById('resumeDialog').style.display = 'none';
            this.clearResumeData();
            this.resumeState = null;
            document.getElementById('chunkSize').disabled = false;
            document.getElementById('chunkSize').style.backgroundColor = '';
            document.getElementById('uploadBtn').textContent = 'Start Upload';
        });

        document.getElementById('confirmResume').addEventListener('click', () => {
            document.getElementById('resumeDialog').style.display = 'none';
            if (this.resumeState) {
                // Resume is a credential-mode feature; make sure that mode is active.
                document.getElementById('usePresigned').checked = false;
                document.getElementById('usePresigned').dispatchEvent(new Event('change'));

                document.getElementById('accessKey').value = this.resumeState.config.accessKey || '';
                document.getElementById('secretKey').value = '';
                document.getElementById('bucketName').value = this.resumeState.config.bucketName || '';
                document.getElementById('chunkSize').value = (this.resumeState.partSize / (1024 * 1024)).toString();
                document.getElementById('objectName').value = this.resumeState.config.objectName || '';

                const fileLabel = document.querySelector('.file-input-label');
                fileLabel.innerHTML = `📁 Please select: <strong>${this.resumeState.fileName}</strong> (${this.formatFileSize(this.resumeState.fileSize)})`;
                fileLabel.style.borderColor = '#ff9500';
                fileLabel.style.backgroundColor = '#fff8e1';

                document.getElementById('uploadBtn').textContent = 'Resume Upload';
            }
            document.getElementById('chunkSize').disabled = true;
            document.getElementById('chunkSize').style.backgroundColor = '#f5f5f5';
        });
    }

    async startUpload() {
        try {
            this.clearMessages();
            this.setUploadStatus(true);

            this.file = document.getElementById('fileInput').files[0];
            if (!this.file) {
                throw new Error('Please select a file');
            }

            if (document.getElementById('usePresigned').checked) {
                await this.uploadWithPresignedUrl();
            } else {
                await this.uploadWithCredentials();
            }
        } catch (error) {
            console.error('Upload error:', error);
            this.showError(error.message);
        } finally {
            this.setUploadStatus(false);
        }
    }

    // --- Presigned URL flow: single PUT, no SDK, no credentials -------------

    async uploadWithPresignedUrl() {
        const url = document.getElementById('presignedUrl').value.trim();
        if (!url) {
            throw new Error('No upload URL available. Reload the page or paste a presigned URL.');
        }

        this.startTime = Date.now();
        this.uploadedBytes = 0;
        await this.putToPresignedUrl(url, this.file);

        const totalTime = (Date.now() - this.startTime) / 1000;
        this.updateProgress(100, '✅ Upload completed successfully!');
        this.showSuccess(`
            📁 File: ${this.file.name} (${this.formatFileSize(this.file.size)})<br>
            ⏱️ Total time: ${this.formatTime(totalTime)}
        `);
    }

    // Plain HTTP PUT to a presigned URL. The bucket's default SSE-KMS applies
    // server-side, so no encryption header is sent here. XHR is used rather
    // than fetch because it reports upload progress events.
    putToPresignedUrl(url, file) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url, true);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    this.uploadedBytes = e.loaded;
                    const pct = (e.loaded / e.total) * 100;
                    this.updateProgress(pct, `📊 Uploading… ${pct.toFixed(0)}%`);
                }
            };
            xhr.onload = () =>
                (xhr.status >= 200 && xhr.status < 300)
                    ? resolve()
                    : reject(new Error(`Upload failed: HTTP ${xhr.status} ${xhr.statusText}`));
            xhr.onerror = () => reject(new Error('Network error during upload'));
            xhr.send(file);
        });
    }

    // --- Credential flow: multipart upload via the AWS SDK ------------------

    async uploadWithCredentials() {
        // Resume takes over if the selected file matches an interrupted upload.
        if (this.resumeState && this.file.name === this.resumeState.fileName && this.file.size === this.resumeState.fileSize) {
            await this.resumeUpload();
            return;
        }

        this.config = {
            accessKey: document.getElementById('accessKey').value,
            secretKey: document.getElementById('secretKey').value,
            region: 'eu-central-1',
            bucketName: document.getElementById('bucketName').value.replace(/\s/g, ''),
        };

        if (!this.config.accessKey || !this.config.secretKey) {
            throw new Error('Enter your AWS access key and secret key, or switch to presigned URL mode');
        }
        if (!this.config.bucketName) {
            throw new Error('Enter the S3 bucket name');
        }

        const chunkSizeMB = parseInt(document.getElementById('chunkSize').value);
        this.partSize = chunkSizeMB * 1024 * 1024;
        this.config.objectName = document.getElementById('objectName').value || this.file.name;

        this.s3 = new S3Client({
            region: this.config.region,
            credentials: {
                accessKeyId: this.config.accessKey,
                secretAccessKey: this.config.secretKey
            },
            forcePathStyle: false,
            useAccelerateEndpoint: false,
            useDualstackEndpoint: false
        });

        await this.proceedWithUpload();
    }

    async proceedWithUpload() {
        try {
            this.startTime = Date.now();
            this.uploadedBytes = 0;
            this.parts = [];

            this.updateProgress(0, '🚀 Starting multipart upload...');

            const createCommand = new CreateMultipartUploadCommand({
                Bucket: this.config.bucketName,
                Key: this.config.objectName
            });
            const createResult = await this.s3.send(createCommand);

            this.uploadId = createResult.UploadId;
            this.saveUploadState();

            const totalParts = Math.ceil(this.file.size / this.partSize);
            for (let i = 0; i < totalParts; i++) {
                await this.uploadPart(i + 1, totalParts);
            }

            await this.completeMultipartUpload();

        } catch (error) {
            if (this.uploadId) {
                try {
                    const abortCommand = new AbortMultipartUploadCommand({
                        Bucket: this.config.bucketName,
                        Key: this.config.objectName,
                        UploadId: this.uploadId
                    });
                    await this.s3.send(abortCommand);
                } catch (abortError) {
                    console.error('Failed to abort multipart upload:', abortError);
                }
            }

            if (error.name === 'PreconditionFailed' || error.code === 'PreconditionFailed') {
                throw new Error(`❌ File "${this.config.objectName}" already exists and cannot be overwritten due to bucket policy.`);
            }

            throw error;
        }
    }

    async uploadPart(partNumber, totalParts) {
        const start = (partNumber - 1) * this.partSize;
        const end = Math.min(start + this.partSize, this.file.size);
        const partData = this.file.slice(start, end);

        const uploadCommand = new UploadPartCommand({
            Bucket: this.config.bucketName,
            Key: this.config.objectName,
            PartNumber: partNumber,
            UploadId: this.uploadId,
            Body: partData
        });

        const progress = ((partNumber - 1) / Math.ceil(this.file.size / this.partSize)) * 100;
        this.updateProgress(progress, `📊 Uploading part ${partNumber}/${totalParts}...`);

        const uploadResult = await this.s3.send(uploadCommand);

        this.parts.push({
            ETag: uploadResult.ETag,
            PartNumber: partNumber
        });

        this.uploadedBytes += partData.size;
        const finalProgress = (this.uploadedBytes / this.file.size) * 100;
        this.updateProgress(finalProgress, `📊 Part ${partNumber}/${totalParts} completed`);

        this.saveUploadState();
    }

    async completeMultipartUpload() {
        this.parts.sort((a, b) => a.PartNumber - b.PartNumber);

        const completeCommand = new CompleteMultipartUploadCommand({
            Bucket: this.config.bucketName,
            Key: this.config.objectName,
            UploadId: this.uploadId,
            MultipartUpload: {
                Parts: this.parts
            }
        });
        completeCommand.middlewareStack.add(
            (next) => async (args) => {
                args.request.headers['if-none-match'] = '*';
                return next(args);
            },
            { step: 'build' }
        );

        try {
            await this.s3.send(completeCommand);
        } catch (error) {
            if (error.name === 'PreconditionFailed' || error.code === 'PreconditionFailed') {
                this.showError(`File "${this.config.objectName}" already exists and cannot be overwritten due to bucket policy.`);
                return;
            }
            throw error;
        }

        const totalTime = Date.now() - this.startTime;
        const avgSpeed = (this.file.size / (totalTime / 1000)) / (1024 * 1024);

        this.updateProgress(100, '✅ Upload completed successfully!');

        this.clearResumeData();
        this.resumeState = null;
        document.getElementById('uploadBtn').textContent = 'Start Upload';
        this.showSuccess(`
            📁 File: ${this.file.name} (${this.formatFileSize(this.file.size)})<br>
            📍 Destination: s3://${this.config.bucketName}/${this.config.objectName}<br>
            ⏱️ Total time: ${this.formatTime(totalTime / 1000)}<br>
            📈 Average speed: ${avgSpeed.toFixed(1)} MB/s
        `);
    }

    // --- Shared UI helpers --------------------------------------------------

    updateProgress(percent, message) {
        const progressContainer = document.getElementById('progressContainer');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const speedElement = document.getElementById('uploadSpeed');
        const etaElement = document.getElementById('uploadEta');

        progressContainer.style.display = 'block';
        progressFill.style.width = `${percent}%`;
        progressText.textContent = message;

        if (this.startTime && this.uploadedBytes > 0 && percent > 0 && percent < 100) {
            const elapsed = (Date.now() - this.startTime) / 1000;
            const speed = (this.uploadedBytes / elapsed) / (1024 * 1024);
            speedElement.textContent = `${speed.toFixed(1)} MB/s`;

            const remainingBytes = this.file.size - this.uploadedBytes;
            const remainingSeconds = remainingBytes / (speed * 1024 * 1024);
            etaElement.textContent = `ETA: ${this.formatTime(remainingSeconds)}`;
        } else {
            speedElement.textContent = '0 MB/s';
            etaElement.textContent = percent >= 100 ? 'Completed' : 'Calculating...';
        }
    }

    setUploadStatus(uploading) {
        const uploadBtn = document.getElementById('uploadBtn');
        const form = document.getElementById('uploadForm');

        uploadBtn.disabled = uploading;
        uploadBtn.textContent = uploading ? 'Uploading...' : 'Start Upload';

        const inputs = form.querySelectorAll('input, select');
        inputs.forEach(input => input.disabled = uploading);
    }

    showError(message) {
        const errorDiv = document.getElementById('errorMsg');
        errorDiv.className = 'error';
        errorDiv.style.display = 'block';
        errorDiv.innerHTML = `❌ ${message}`;
    }

    showSuccess(message) {
        const successDiv = document.getElementById('successMsg');
        successDiv.className = 'success';
        successDiv.style.display = 'block';
        successDiv.innerHTML = message;
    }

    clearMessages() {
        const errorDiv = document.getElementById('errorMsg');
        const successDiv = document.getElementById('successMsg');
        errorDiv.innerHTML = '';
        errorDiv.style.display = 'none';
        successDiv.innerHTML = '';
        successDiv.style.display = 'none';
        document.getElementById('progressContainer').style.display = 'none';
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatTime(seconds) {
        if (seconds < 60) {
            return `${Math.round(seconds)}s`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const secs = Math.round(seconds % 60);
            return `${minutes}m${secs.toString().padStart(2, '0')}s`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}h${minutes.toString().padStart(2, '0')}m`;
        }
    }

    // --- Resume (credential mode) -------------------------------------------

    checkForResumeableUpload() {
        try {
            const savedState = localStorage.getItem('s3_upload_state');
            if (savedState) {
                this.resumeState = JSON.parse(savedState);
                this.showResumeDialog();
            }
        } catch (error) {
            console.log('No resumeable upload found');
            localStorage.removeItem('s3_upload_state');
        }
    }

    showResumeDialog() {
        const dialog = document.getElementById('resumeDialog');
        const message = document.getElementById('resumeMessage');
        const progress = ((this.resumeState.uploadedParts.length * this.resumeState.partSize) / this.resumeState.fileSize * 100).toFixed(1);
        message.innerHTML = `Found interrupted upload for "${this.resumeState.fileName}" (${progress}% completed).<br><br><strong>Please select the same file again to resume the upload.</strong>`;
        dialog.style.display = 'block';
    }

    async resumeUpload() {
        try {
            this.clearMessages();

            const fileInput = document.getElementById('fileInput');
            this.file = fileInput.files[0];

            if (!this.file) {
                throw new Error('Please select a file to resume the upload.');
            }
            if (this.file.name !== this.resumeState.fileName) {
                throw new Error(`Please select the original file "${this.resumeState.fileName}".`);
            }
            if (this.file.size !== this.resumeState.fileSize) {
                throw new Error(`File size mismatch. Expected ${this.formatFileSize(this.resumeState.fileSize)}, got ${this.formatFileSize(this.file.size)}.`);
            }

            this.config = {
                accessKey: document.getElementById('accessKey').value,
                secretKey: document.getElementById('secretKey').value,
                region: this.resumeState.config.region,
                bucketName: this.resumeState.config.bucketName,
                objectName: this.resumeState.config.objectName
            };
            this.uploadId = this.resumeState.uploadId;
            this.partSize = this.resumeState.partSize;
            this.parts = this.resumeState.uploadedParts || [];
            this.uploadedBytes = this.parts.length * this.partSize;

            this.s3 = new S3Client({
                region: this.config.region,
                credentials: {
                    accessKeyId: this.config.accessKey,
                    secretAccessKey: this.config.secretKey
                },
                forcePathStyle: false,
                useAccelerateEndpoint: false,
                useDualstackEndpoint: false
            });

            await this.verifyAndResumeUpload();

        } catch (error) {
            console.error('Resume error:', error);
            this.showError(`Resume failed: ${error.message}`);
            this.clearResumeData();
        }
    }

    async verifyAndResumeUpload() {
        this.updateProgress(0, '🔍 Verifying upload state...');

        try {
            const listCommand = new ListPartsCommand({
                Bucket: this.config.bucketName,
                Key: this.config.objectName,
                UploadId: this.uploadId
            });
            const listResult = await this.s3.send(listCommand);

            this.parts = listResult.Parts ? listResult.Parts.map(part => ({
                ETag: part.ETag,
                PartNumber: part.PartNumber
            })) : [];

            this.uploadedBytes = this.parts.length * this.partSize;

            this.startTime = Date.now();
            const currentProgress = (this.uploadedBytes / this.file.size) * 100;
            this.updateProgress(currentProgress, `📊 Resuming from ${currentProgress.toFixed(1)}%...`);

            const totalParts = Math.ceil(this.file.size / this.partSize);
            const startPart = this.parts.length + 1;

            if (startPart <= totalParts) {
                for (let i = startPart; i <= totalParts; i++) {
                    await this.uploadPart(i, totalParts);
                }
            }

            await this.completeMultipartUpload();

        } catch (error) {
            console.error('Verify and resume error:', error);
            if (error.code === 'NoSuchUpload') {
                throw new Error('Upload session expired. Please start a new upload.');
            }
            throw error;
        }
    }

    saveUploadState() {
        const uploadState = {
            uploadId: this.uploadId,
            fileName: this.file.name,
            fileSize: this.file.size,
            partSize: this.partSize,
            uploadedParts: this.parts,
            config: {
                accessKey: this.config.accessKey,
                region: this.config.region,
                bucketName: this.config.bucketName,
                objectName: this.config.objectName || this.file.name
                // Never save secretKey for security
            }
        };
        localStorage.setItem('s3_upload_state', JSON.stringify(uploadState));
    }

    clearResumeData() {
        localStorage.removeItem('s3_upload_state');
    }

    setupBucketNameCleaning() {
        const bucketNameInput = document.getElementById('bucketName');

        bucketNameInput.addEventListener('input', (e) => {
            const cleanValue = e.target.value.replace(/\s/g, '');
            if (e.target.value !== cleanValue) {
                e.target.value = cleanValue;
            }
        });

        bucketNameInput.addEventListener('paste', (e) => {
            setTimeout(() => {
                const cleanValue = e.target.value.replace(/\s/g, '');
                e.target.value = cleanValue;
            }, 0);
        });
    }
}

// Initialize the uploader when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new S3Uploader();
});
