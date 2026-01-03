import { db } from "./db";
import { customerApiLogs, projects } from "@shared/schema";
import { eq } from "drizzle-orm";
import * as fs from "fs/promises";
import * as fsSync from "fs";
import * as path from "path";

function findFirstImageInDirectory(dirPath: string, photoPattern?: string): string | null {
  if (!fsSync.existsSync(dirPath)) return null;
  
  const stat = fsSync.statSync(dirPath);
  if (!stat.isDirectory()) {
    if (isImageFile(dirPath)) return dirPath;
    return null;
  }
  
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
  
  try {
    const files = fsSync.readdirSync(dirPath);
    
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      if (imageExtensions.includes(ext)) {
        const filePath = path.join(dirPath, file);
        const fileStat = fsSync.statSync(filePath);
        if (fileStat.isFile()) {
          if (photoPattern && !file.toLowerCase().includes(photoPattern.toLowerCase())) {
            continue;
          }
          return filePath;
        }
      }
    }
    
    for (const file of files) {
      const subPath = path.join(dirPath, file);
      try {
        const subStat = fsSync.statSync(subPath);
        if (subStat.isDirectory()) {
          const found = findFirstImageInDirectory(subPath, photoPattern);
          if (found) return found;
        }
      } catch {
      }
    }
  } catch (err) {
    console.error("[CustomerAPI] Error reading directory:", err);
  }
  
  return null;
}

function findPhotoInWorkOrderFolder(folderPath: string, photoType: string): string | null {
  if (!fsSync.existsSync(folderPath)) return null;
  
  const subfolderPath = path.join(folderPath, photoType);
  if (fsSync.existsSync(subfolderPath)) {
    const result = findFirstImageInDirectory(subfolderPath);
    if (result) return result;
  }
  
  const imageExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];
  try {
    const files = fsSync.readdirSync(folderPath);
    for (const file of files) {
      const lowerFile = file.toLowerCase();
      if (lowerFile.includes(`-${photoType}-`) || lowerFile.includes(`_${photoType}_`) || lowerFile.startsWith(`${photoType}-`) || lowerFile.startsWith(`${photoType}_`)) {
        const ext = path.extname(file).toLowerCase();
        if (imageExtensions.includes(ext)) {
          return path.join(folderPath, file);
        }
      }
    }
  } catch {
  }
  
  return null;
}

function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext);
}

interface WorkOrderPayload {
  workOrderId: number;
  customerWoId: string;
  status: string;
  oldMeterNumber: string | null;
  newMeterNumber: string | null;
  oldMeterReading: string | null;
  newMeterReading: string | null;
  latitude: string | null;
  longitude: string | null;
  gpsAccuracy: string | null;
  serviceAddress: string | null;
  serviceCity: string | null;
  serviceState: string | null;
  serviceZip: string | null;
  completedAt: string | null;
  completedBy: string | null;
  notes: string | null;
  troubleCode: string | null;
  serviceType: string | null;
  meterType: string | null;
  beforePhoto?: string | null;
  afterPhoto?: string | null;
  signature?: string | null;
}

interface CustomerApiConfig {
  projectId: number;
  customerApiEnabled: boolean | null;
  customerApiUrl: string | null;
  customerApiAuthType: string | null;
  customerApiKeyHeader: string | null;
  customerApiSecretEnvVar: string | null;
  customerApiSendPhotos: boolean | null;
}

async function getProjectApiConfig(projectId: number): Promise<CustomerApiConfig | null> {
  const [project] = await db
    .select({
      projectId: projects.id,
      customerApiEnabled: projects.customerApiEnabled,
      customerApiUrl: projects.customerApiUrl,
      customerApiAuthType: projects.customerApiAuthType,
      customerApiKeyHeader: projects.customerApiKeyHeader,
      customerApiSecretEnvVar: projects.customerApiSecretEnvVar,
      customerApiSendPhotos: projects.customerApiSendPhotos,
    })
    .from(projects)
    .where(eq(projects.id, projectId));

  return project || null;
}

function getAuthHeaders(config: CustomerApiConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (!config.customerApiAuthType || config.customerApiAuthType === "none") {
    return headers;
  }

  const secretEnvVar = config.customerApiSecretEnvVar;
  if (!secretEnvVar) {
    console.warn(`[CustomerAPI] No secret env var configured for project ${config.projectId}`);
    return headers;
  }

  const secret = process.env[secretEnvVar];
  if (!secret) {
    console.warn(`[CustomerAPI] Environment variable ${secretEnvVar} not found`);
    return headers;
  }

  switch (config.customerApiAuthType) {
    case "api_key":
      const headerName = config.customerApiKeyHeader || "X-API-Key";
      headers[headerName] = secret;
      break;
    case "bearer_token":
      headers["Authorization"] = `Bearer ${secret}`;
      break;
    case "basic_auth":
      headers["Authorization"] = `Basic ${Buffer.from(secret).toString("base64")}`;
      break;
  }

  return headers;
}

async function readFileAsBase64(filePath: string): Promise<string | null> {
  try {
    if (!filePath) return null;
    const absolutePath = path.isAbsolute(filePath) 
      ? filePath 
      : path.join(process.cwd(), filePath);
    const fileBuffer = await fs.readFile(absolutePath);
    return fileBuffer.toString("base64");
  } catch (error) {
    console.warn(`[CustomerAPI] Failed to read file ${filePath}:`, error);
    return null;
  }
}

async function logApiCall(
  projectId: number,
  workOrderId: number | null,
  customerWoId: string | null,
  requestUrl: string,
  requestPayload: string,
  responseStatus: number | null,
  responseBody: string | null,
  success: boolean,
  errorMessage: string | null
): Promise<void> {
  try {
    await db.insert(customerApiLogs).values({
      projectId,
      workOrderId,
      customerWoId,
      requestUrl,
      requestMethod: "POST",
      requestPayload,
      responseStatus,
      responseBody,
      success,
      errorMessage,
      retryCount: 0,
    });
  } catch (error) {
    console.error("[CustomerAPI] Failed to log API call:", error);
  }
}

export async function sendWorkOrderToCustomerApi(
  projectId: number,
  workOrder: Record<string, any>,
  photoFiles?: {
    beforePhoto?: string | null;
    afterPhoto?: string | null;
    signature?: string | null;
    workOrderFolderPath?: string | null;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const config = await getProjectApiConfig(projectId);
    
    if (!config || !config.customerApiEnabled || !config.customerApiUrl) {
      console.log(`[CustomerAPI] API not enabled for project ${projectId}`);
      return { success: true };
    }

    console.log(`[CustomerAPI] Sending work order ${workOrder.id} to ${config.customerApiUrl}`);

    const rawCompletedAt = workOrder.completedAt || workOrder.completed_at || null;
    const completedAt = rawCompletedAt instanceof Date 
      ? rawCompletedAt.toISOString() 
      : (typeof rawCompletedAt === 'string' ? rawCompletedAt : null);
    
    const gpsString = workOrder.newGps || workOrder.new_gps || "";
    const gpsParts = gpsString.split(",").map((s: string) => s.trim());
    const latitude = workOrder.latitude || (gpsParts[0] || null);
    const longitude = workOrder.longitude || (gpsParts[1] || null);
    
    const payload: WorkOrderPayload = {
      workOrderId: workOrder.id,
      customerWoId: workOrder.customerWoId || workOrder.customer_wo_id || "",
      status: workOrder.status || "",
      oldMeterNumber: workOrder.oldMeterNumber || workOrder.old_meter_number || workOrder.oldMeterId || workOrder.old_meter_id || null,
      newMeterNumber: workOrder.newMeterNumber || workOrder.new_meter_number || workOrder.newMeterId || workOrder.new_meter_id || null,
      oldMeterReading: (workOrder.oldMeterReading ?? workOrder.old_meter_reading)?.toString() || null,
      newMeterReading: (workOrder.newMeterReading ?? workOrder.new_meter_reading)?.toString() || null,
      latitude,
      longitude,
      gpsAccuracy: workOrder.gpsAccuracy || workOrder.gps_accuracy || null,
      serviceAddress: workOrder.serviceAddress || workOrder.service_address || workOrder.address || null,
      serviceCity: workOrder.serviceCity || workOrder.service_city || workOrder.city || null,
      serviceState: workOrder.serviceState || workOrder.service_state || workOrder.state || null,
      serviceZip: workOrder.serviceZip || workOrder.service_zip || workOrder.zip || null,
      completedAt,
      completedBy: workOrder.completedBy || workOrder.completed_by || null,
      notes: workOrder.notes || null,
      troubleCode: workOrder.troubleCode || workOrder.trouble_code || workOrder.trouble || null,
      serviceType: workOrder.serviceType || workOrder.service_type || null,
      meterType: workOrder.meterType || workOrder.meter_type || workOrder.newMeterType || workOrder.new_meter_type || null,
    };

    if (config.customerApiSendPhotos && photoFiles) {
      const folderPath = photoFiles.workOrderFolderPath;
      
      let beforePath: string | null = null;
      if (photoFiles.beforePhoto) {
        beforePath = findFirstImageInDirectory(photoFiles.beforePhoto);
      }
      if (!beforePath && folderPath) {
        beforePath = findPhotoInWorkOrderFolder(folderPath, "before");
      }
      if (beforePath) {
        payload.beforePhoto = await readFileAsBase64(beforePath);
      }
      
      let afterPath: string | null = null;
      if (photoFiles.afterPhoto) {
        afterPath = findFirstImageInDirectory(photoFiles.afterPhoto);
      }
      if (!afterPath && folderPath) {
        afterPath = findPhotoInWorkOrderFolder(folderPath, "after");
      }
      if (afterPath) {
        payload.afterPhoto = await readFileAsBase64(afterPath);
      }
      
      let signaturePath: string | null = null;
      if (photoFiles.signature) {
        signaturePath = findFirstImageInDirectory(photoFiles.signature);
      }
      if (!signaturePath && folderPath) {
        signaturePath = findPhotoInWorkOrderFolder(folderPath, "signature");
      }
      if (signaturePath) {
        payload.signature = await readFileAsBase64(signaturePath);
      }
    }

    const headers = getAuthHeaders(config);
    const payloadString = JSON.stringify(payload);

    const response = await fetch(config.customerApiUrl, {
      method: "POST",
      headers,
      body: payloadString,
    });

    const responseBody = await response.text();
    const success = response.ok;

    await logApiCall(
      projectId,
      workOrder.id,
      workOrder.customerWoId,
      config.customerApiUrl,
      payloadString,
      response.status,
      responseBody,
      success,
      success ? null : `HTTP ${response.status}: ${response.statusText}`
    );

    if (!success) {
      console.error(`[CustomerAPI] Failed to send work order ${workOrder.id}: HTTP ${response.status}`);
      return { success: false, error: `HTTP ${response.status}: ${response.statusText}` };
    }

    console.log(`[CustomerAPI] Successfully sent work order ${workOrder.id}`);
    return { success: true };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error(`[CustomerAPI] Error sending work order:`, error);

    await logApiCall(
      projectId,
      workOrder.id,
      workOrder.customerWoId || null,
      "N/A",
      JSON.stringify(workOrder),
      null,
      null,
      false,
      errorMessage
    );

    return { success: false, error: errorMessage };
  }
}

export async function getApiLogs(projectId: number, limit: number = 50) {
  return db
    .select()
    .from(customerApiLogs)
    .where(eq(customerApiLogs.projectId, projectId))
    .orderBy(customerApiLogs.createdAt)
    .limit(limit);
}
