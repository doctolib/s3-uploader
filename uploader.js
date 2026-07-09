class S3PresignedUploader {
    constructor() {
        this.file = null;
        this.startTime = null;

        this.initializeUI();
        this.fetchUploadUrl();
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
            }
        });
    }

    // In production the page is served behind Cloudflare Access. On load it asks
    // the broker for a short-lived presigned PUT URL scoped to this session, so
    // the browser never handles AWS credentials. For staging tests, the URL can
    // be pasted into the field manually and this fetch is a no-op.
    async fetchUploadUrl() {
        const field = document.getElementById('presignedUrl');
        if (!field || field.value.trim()) return;
        try {
            const res = await fetch('/api/upload-url', { credentials: 'include' });
            if (!res.ok) throw new Error(`broker returned HTTP ${res.status}`);
            const data = await res.json();
            field.value = data.url;
        } catch (e) {
            console.warn('Could not fetch upload URL from broker (paste one to test):', e.message);
        }
    }

    async startUpload() {
        try {
            this.clearMessages();
            this.setUploadStatus(true);

            this.file = document.getElementById('fileInput').files[0];
            if (!this.file) {
                throw new Error('Please select a file');
            }

            const url = document.getElementById('presignedUrl').value.trim();
            if (!url) {
                throw new Error('No upload URL available. Reload the page or paste a presigned URL.');
            }

            this.startTime = Date.now();
            await this.uploadViaPresignedUrl(url, this.file);

            const totalTime = (Date.now() - this.startTime) / 1000;
            this.updateProgress(100, '✅ Upload completed successfully!');
            this.showSuccess(`
                📁 File: ${this.file.name} (${this.formatFileSize(this.file.size)})<br>
                ⏱️ Total time: ${this.formatTime(totalTime)}
            `);
        } catch (error) {
            console.error('Upload error:', error);
            this.showError(error.message);
        } finally {
            this.setUploadStatus(false);
        }
    }

    // Plain HTTP PUT to a presigned URL: no AWS SDK, no credentials in the
    // browser. The bucket's default SSE-KMS encryption is applied server-side,
    // so no encryption header is sent here. XHR is used rather than fetch
    // because it reports upload progress events.
    uploadViaPresignedUrl(url, file) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', url, true);

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    const pct = (e.loaded / e.total) * 100;
                    this.updateProgress(pct, `📊 Uploading… ${pct.toFixed(0)}%`, e.loaded);
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

    updateProgress(percent, message, loadedBytes) {
        const progressContainer = document.getElementById('progressContainer');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const speedElement = document.getElementById('uploadSpeed');
        const etaElement = document.getElementById('uploadEta');

        progressContainer.style.display = 'block';
        progressFill.style.width = `${percent}%`;
        progressText.textContent = message;

        if (this.startTime && loadedBytes > 0 && percent > 0 && percent < 100) {
            const elapsed = (Date.now() - this.startTime) / 1000;
            const speed = (loadedBytes / elapsed) / (1024 * 1024);
            speedElement.textContent = `${speed.toFixed(1)} MB/s`;

            const remainingBytes = this.file.size - loadedBytes;
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
}

// Initialize the uploader when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new S3PresignedUploader();
});
