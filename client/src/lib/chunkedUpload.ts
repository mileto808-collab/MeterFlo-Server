const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB

export interface ChunkedUploadProgress {
  stage: "uploading" | "processing";
  percent: number;
  message: string;
}

export interface ChunkedUploadOptions {
  file: File;
  url: string;
  onProgress?: (progress: ChunkedUploadProgress) => void;
  fieldName?: string;
}

export async function uploadFileWithChunking({
  file,
  url,
  onProgress,
  fieldName = "file",
}: ChunkedUploadOptions): Promise<Response> {
  if (file.size <= CHUNK_SIZE) {
    onProgress?.({ stage: "uploading", percent: 50, message: "Uploading file..." });

    const formData = new FormData();
    formData.append(fieldName, file);

    const response = await fetch(url, {
      method: "POST",
      body: formData,
      credentials: "include",
    });

    if (response.ok) {
      onProgress?.({ stage: "processing", percent: 100, message: "Complete!" });
    }
    return response;
  }

  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  onProgress?.({ stage: "uploading", percent: 0, message: "Initializing upload..." });

  const initResponse = await fetch("/api/files/chunked/init", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      totalChunks,
      targetUrl: url,
    }),
  });

  if (!initResponse.ok) {
    const error = await initResponse.json();
    throw new Error(error.message || "Failed to initialize upload");
  }

  const { uploadId } = await initResponse.json();

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const chunkFormData = new FormData();
    chunkFormData.append("chunk", chunk, file.name);
    chunkFormData.append("uploadId", uploadId);
    chunkFormData.append("chunkIndex", String(i));

    const percent = Math.round(((i + 1) / totalChunks) * 90);
    onProgress?.({
      stage: "uploading",
      percent,
      message: `Uploading chunk ${i + 1} of ${totalChunks}...`,
    });

    const chunkResponse = await fetch("/api/files/chunked/chunk", {
      method: "POST",
      credentials: "include",
      body: chunkFormData,
    });

    if (!chunkResponse.ok) {
      const error = await chunkResponse.json();
      throw new Error(error.message || `Failed to upload chunk ${i + 1}`);
    }
  }

  onProgress?.({ stage: "processing", percent: 95, message: "Finalizing upload..." });

  const finalizeResponse = await fetch("/api/files/chunked/finalize", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId }),
  });

  if (finalizeResponse.ok) {
    onProgress?.({ stage: "processing", percent: 100, message: "Complete!" });
  }

  return finalizeResponse;
}
