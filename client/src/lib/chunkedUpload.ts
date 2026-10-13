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
  forceChunking?: boolean;
  chunkBaseUrl?: string;
  metadata?: unknown;
}

export async function uploadFileWithChunking({
  file,
  url,
  onProgress,
  fieldName = "file",
  forceChunking = false,
  chunkBaseUrl = "/api/files/chunked",
  metadata,
}: ChunkedUploadOptions): Promise<Response> {
  if (file.size <= CHUNK_SIZE && !forceChunking) {
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
  const isCustomUpload = chunkBaseUrl !== "/api/files/chunked";
  const route = (name: string) => `${chunkBaseUrl}/${name}`;
  let uploadId: string | undefined;

  onProgress?.({ stage: "uploading", percent: 0, message: "Initializing upload..." });

  const initPayload: Record<string, unknown> = {
    fileName: file.name,
    totalChunks,
  };
  if (chunkBaseUrl === "/api/files/chunked") initPayload.targetUrl = url;
  if (metadata !== undefined) {
    initPayload.totalSize = file.size;
    initPayload.metadata = metadata;
  }
  const initResponse = await fetch(route("init"), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(initPayload),
  });

  if (!initResponse.ok) {
    throw await uploadError(initResponse, "Failed to initialize upload", isCustomUpload);
  }

  const initialized = await initResponse.json();
  if (typeof initialized?.uploadId !== "string" || !initialized.uploadId) {
    throw new Error("The upload service did not return an upload session.");
  }
  uploadId = initialized.uploadId;
  try {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      const chunkFormData = new FormData();
      chunkFormData.append("chunk", chunk, file.name);
      chunkFormData.append("uploadId", initialized.uploadId);
      chunkFormData.append("chunkIndex", String(i));

      const percent = Math.round(((i + 1) / totalChunks) * 90);
      onProgress?.({
        stage: "uploading",
        percent,
        message: `Uploading chunk ${i + 1} of ${totalChunks}...`,
      });

      const chunkResponse = await fetch(route("chunk"), {
        method: "POST",
        credentials: "include",
        body: chunkFormData,
      });

      if (!chunkResponse.ok) {
        throw await uploadError(chunkResponse, `Failed to upload chunk ${i + 1}`, isCustomUpload);
      }
    }

    onProgress?.({ stage: "processing", percent: 95, message: "Finalizing upload..." });

    const finalizeResponse = await fetch(route("finalize"), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: initialized.uploadId }),
    });

    if (!finalizeResponse.ok) {
      throw await uploadError(finalizeResponse, "Failed to finalize upload", isCustomUpload);
    }
    onProgress?.({ stage: "processing", percent: 100, message: "Complete!" });
    return finalizeResponse;
  } catch (error) {
    if (isCustomUpload && uploadId) {
      try {
        await fetch(`${chunkBaseUrl}/${encodeURIComponent(uploadId)}`, {
          method: "DELETE",
          credentials: "include",
        });
      } catch {
        // Preserve the original upload error; the session may expire server-side.
      }
    }
    throw error;
  }
}

async function getUploadError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return typeof body?.message === "string" ? body.message : fallback;
  } catch {
    return fallback;
  }
}

async function uploadError(response: Response, fallback: string, includeStatus: boolean): Promise<Error> {
  const message = await getUploadError(response, fallback);
  return new Error(includeStatus ? `${response.status}: ${message}` : message);
}
