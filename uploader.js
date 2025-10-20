import { S3Client, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListObjectsV2Command, ListPartsCommand } from 'https://cdn.skypack.dev/@aws-sdk/client-s3@3.637.0';

class S3MultipartUploader {
    constructor() {
        this.partSize = 100 * 1024 * 1024; // Default 100MB, will be set from form
        this.concurrency = 3;
        this.s3 = null;
        this.uploadId = null;
        this.parts = [];
        this.uploadedBytes = 0;
        this.startTime = null;
        this.file = null;
        this.config = {};
        this.lastProgressUpdate = 0;
        this.resumeState = null;

        this.initializeUI();
        this.checkForResumeableUpload();
        this.setupBucketNameCleaning();
    }

    initializeUI() {
        const form = document.getElementById('uploadForm');
        const fileInput = document.getElementById('fileInput');
        const fileLabel = document.querySelector('.file-input-label');

        // Handle form submission
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            this.startUpload();
        });

        // Handle file selection
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                fileLabel.textContent = `📁 ${file.name} (${this.formatFileSize(file.size)})`;
                fileLabel.style.borderColor = '#e1e5e9';
                fileLabel.style.backgroundColor = '';
                
                // If we have a resume state and this matches the expected file, show resume option
                if (this.resumeState && file.name === this.resumeState.fileName && file.size === this.resumeState.fileSize) {
                    fileLabel.innerHTML = `📁 ${file.name} (${this.formatFileSize(file.size)}) <span style="color: #28a745;">✅ Ready to resume</span>`;
                    fileLabel.style.borderColor = '#28a745';
                    fileLabel.style.backgroundColor = '#f8fff8';
                }
            }
        });

        // Handle drag & drop
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
                // Create a new DataTransfer object and assign the files
                const dataTransfer = new DataTransfer();
                for (let i = 0; i < files.length; i++) {
                    dataTransfer.items.add(files[i]);
                }
                fileInput.files = dataTransfer.files;
                
                fileLabel.textContent = `📁 ${files[0].name} (${this.formatFileSize(files[0].size)})`;
                
                // If we have a resume state and this matches the expected file, show resume option
                if (this.resumeState && files[0].name === this.resumeState.fileName && files[0].size === this.resumeState.fileSize) {
                    fileLabel.innerHTML = `📁 ${files[0].name} (${this.formatFileSize(files[0].size)}) <span style="color: #28a745;">✅ Ready to resume</span>`;
                    fileLabel.style.borderColor = '#28a745';
                    fileLabel.style.backgroundColor = '#f8fff8';
                }
            }
        });


        // Resume dialog handlers
        document.getElementById('cancelResume').addEventListener('click', () => {
            document.getElementById('resumeDialog').style.display = 'none';
            this.clearResumeData();
            this.resumeState = null;
            // Unlock chunk size for new upload
            document.getElementById('chunkSize').disabled = false;
            document.getElementById('chunkSize').style.backgroundColor = '';
            // Reset button text to Start Upload
            document.getElementById('uploadBtn').textContent = 'Start Upload';
        });

        document.getElementById('confirmResume').addEventListener('click', () => {
            document.getElementById('resumeDialog').style.display = 'none';
            // Pre-fill form with resume data if available
            if (this.resumeState) {
                document.getElementById('accessKey').value = this.resumeState.config.accessKey || '';
                // Never pre-fill secret key for security
                document.getElementById('secretKey').value = '';
                document.getElementById('bucketName').value = this.resumeState.config.bucketName || '';
                document.getElementById('chunkSize').value = (this.resumeState.partSize / (1024 * 1024)).toString();
                document.getElementById('objectName').value = this.resumeState.config.objectName || '';
                
                // Update file label to show expected file
                const fileLabel = document.querySelector('.file-input-label');
                fileLabel.innerHTML = `📁 Please select: <strong>${this.resumeState.fileName}</strong> (${this.formatFileSize(this.resumeState.fileSize)})`;
                fileLabel.style.borderColor = '#ff9500';
                fileLabel.style.backgroundColor = '#fff8e1';
                
                // Change button text to Resume Upload
                document.getElementById('uploadBtn').textContent = 'Resume Upload';
            }
            // Lock chunk size to prevent issues with existing parts
            document.getElementById('chunkSize').disabled = true;
            document.getElementById('chunkSize').style.backgroundColor = '#f5f5f5';
            // Don't call resumeUpload() immediately, wait for file selection
        });
    }

    async startUpload() {
        console.log('startUpload called');
        try {
            this.clearMessages();
            this.setUploadStatus(true);

            // Check if this is a resume attempt
            const file = document.getElementById('fileInput').files[0];
            if (this.resumeState && file && file.name === this.resumeState.fileName && file.size === this.resumeState.fileSize) {
                // This is a resume operation
                await this.resumeUpload();
                return;
            }

            // Regular upload flow
            this.config = {
                accessKey: document.getElementById('accessKey').value,
                secretKey: document.getElementById('secretKey').value,
                region: 'eu-central-1', // Default region
                bucketName: document.getElementById('bucketName').value.replace(/\s/g, ''),
            };

            // Set chunk size from dropdown
            const chunkSizeMB = parseInt(document.getElementById('chunkSize').value);
            const newPartSize = chunkSizeMB * 1024 * 1024;
            
            // Validate chunk size for resume uploads
            if (this.resumeState && this.resumeState.partSize !== newPartSize) {
                throw new Error(`Cannot change chunk size during resume. Expected ${this.resumeState.partSize / (1024*1024)}MB, got ${chunkSizeMB}MB`);
            }
            
            this.partSize = newPartSize;

            this.file = file;
            console.log('Selected file:', this.file);
            if (!this.file) {
                console.error('No file selected');
                throw new Error('Please select a file');
            }

            // Set object name
            this.config.objectName = document.getElementById('objectName').value || this.file.name;

            // Configure AWS SDK v3
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

            // Proceed directly with upload (no object existence check)
            this.proceedWithUpload();

        } catch (error) {
            console.error('Upload error:', error);
            this.showError(error.message);
            this.setUploadStatus(false);
        }
    }



    async proceedWithUpload() {
        try {
            this.startTime = Date.now();
            this.uploadedBytes = 0;
            this.parts = [];

            this.updateProgress(0, '🚀 Starting multipart upload...');

            // Create multipart upload
            const createCommand = new CreateMultipartUploadCommand({
                Bucket: this.config.bucketName,
                Key: this.config.objectName
            });
            const createResult = await this.s3.send(createCommand);

            this.uploadId = createResult.UploadId;

            // Save initial upload state
            this.saveUploadState();

            // Calculate parts
            const totalParts = Math.ceil(this.file.size / this.partSize);
            
            // Upload parts sequentially with concurrency control
            for (let i = 0; i < totalParts; i++) {
                await this.uploadPart(i + 1, totalParts);
            }

            // Complete multipart upload
            await this.completeMultipartUpload();

        } catch (error) {
            if (this.uploadId) {
                // Abort multipart upload on error
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
            
            // Handle specific overwrite error
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
        
        // Simple progress update
        const progress = ((partNumber - 1) / Math.ceil(this.file.size / this.partSize)) * 100;
        this.updateProgress(progress, `📊 Uploading part ${partNumber}/${totalParts}...`);
        
        const uploadResult = await this.s3.send(uploadCommand);

        this.parts.push({
            ETag: uploadResult.ETag,
            PartNumber: partNumber
        });

        // Update final progress for this part
        this.uploadedBytes += partData.size;
        const finalProgress = (this.uploadedBytes / this.file.size) * 100;
        this.updateProgress(finalProgress, `📊 Part ${partNumber}/${totalParts} completed`);

        // Save progress after each part
        this.saveUploadState();
    }

    async completeMultipartUpload() {
        // Sort parts by part number
        this.parts.sort((a, b) => a.PartNumber - b.PartNumber);

        const completeCommand = new CompleteMultipartUploadCommand({
            Bucket: this.config.bucketName,
            Key: this.config.objectName,
            UploadId: this.uploadId,
            MultipartUpload: {
                Parts: this.parts
            }
        });
        // Add conditional write header for completion
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
            // Handle specific overwrite error
            if (error.name === 'PreconditionFailed' || error.code === 'PreconditionFailed') {
                this.showError(`File "${this.config.objectName}" already exists and cannot be overwritten due to bucket policy.`);
                this.setUploadStatus(false);
                return;
            }
            // Re-throw other errors to be handled by proceedWithUpload
            throw error;
        }

        const totalTime = Date.now() - this.startTime;
        const avgSpeed = (this.file.size / (totalTime / 1000)) / (1024 * 1024);

        this.updateProgress(100, '✅ Upload completed successfully!');
        
        // Clear resume data on successful completion
        this.clearResumeData();
        this.resumeState = null;
        // Reset button text after successful upload
        document.getElementById('uploadBtn').textContent = 'Start Upload';
        this.showSuccess(`
            📁 File: ${this.file.name} (${this.formatFileSize(this.file.size)})<br>
            📍 Destination: s3://${this.config.bucketName}/${this.config.objectName}<br>
            ⏱️ Total time: ${this.formatTime(totalTime / 1000)}<br>
            📈 Average speed: ${avgSpeed.toFixed(1)} MB/s
        `);
        this.setUploadStatus(false);
    }

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

            // Calculate ETA
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
        
        // Disable/enable form inputs
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
            console.log('Starting resume upload...');
            this.clearMessages();

            // Get the selected file
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

            // Restore state with fresh credentials from form
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

            console.log('Resume state:', {
                fileName: this.file.name,
                uploadId: this.uploadId,
                partSize: this.partSize,
                existingParts: this.parts.length
            });

            // Configure AWS SDK v3
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

            // Verify upload still exists and get current parts
            await this.verifyAndResumeUpload();

        } catch (error) {
            console.error('Resume error:', error);
            this.showError(`Resume failed: ${error.message}`);
            this.setUploadStatus(false);
            this.clearResumeData();
        }
    }

    async verifyAndResumeUpload() {
        this.updateProgress(0, '🔍 Verifying upload state...');

        try {
            console.log('Verifying upload with:', {
                bucket: this.config.bucketName,
                key: this.config.objectName,
                uploadId: this.uploadId
            });

            // List existing parts
            const listCommand = new ListPartsCommand({
                Bucket: this.config.bucketName,
                Key: this.config.objectName,
                UploadId: this.uploadId
            });
            const listResult = await this.s3.send(listCommand);

            console.log('S3 ListParts result:', listResult);

            // Update parts list with existing parts from S3
            this.parts = listResult.Parts ? listResult.Parts.map(part => ({
                ETag: part.ETag,
                PartNumber: part.PartNumber
            })) : [];

            console.log('Existing parts on S3:', this.parts);

            // Calculate uploaded bytes based on actual parts
            this.uploadedBytes = this.parts.length * this.partSize;
            
            this.startTime = Date.now();
            const currentProgress = (this.uploadedBytes / this.file.size) * 100;
            this.updateProgress(currentProgress, `📊 Resuming from ${currentProgress.toFixed(1)}%...`);

            // Continue with remaining parts
            const totalParts = Math.ceil(this.file.size / this.partSize);
            const startPart = this.parts.length + 1;

            console.log(`Total parts needed: ${totalParts}, starting from part: ${startPart}`);

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
            // Remove spaces automatically as user types
            const cleanValue = e.target.value.replace(/\s/g, '');
            if (e.target.value !== cleanValue) {
                e.target.value = cleanValue;
            }
        });

        bucketNameInput.addEventListener('paste', (e) => {
            // Clean pasted content
            setTimeout(() => {
                const cleanValue = e.target.value.replace(/\s/g, '');
                e.target.value = cleanValue;
            }, 0);
        });
    }
}

// Initialize the uploader when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new S3MultipartUploader();
});