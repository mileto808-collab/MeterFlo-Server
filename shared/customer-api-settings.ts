import { z } from "zod";

export const customerPushFields = [
  "customerApiEnabled", "customerApiUrl", "customerApiAuthType",
  "customerApiKeyHeader", "customerApiSecretEnvVar", "customerApiSendPhotos",
] as const;

export const isCustomerKeyHeader = (name: string) =>
  /^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) &&
  !["content-type", "idempotency-key", "x-meterflo-delivery-id"].includes(name.toLowerCase());

export const customerPushSchema = z.object({
  customerApiEnabled: z.boolean(),
  customerApiUrl: z.string().trim().max(500),
  customerApiAuthType: z.enum(["none", "api_key", "bearer_token", "basic_auth"]),
  customerApiKeyHeader: z.string().trim().max(100),
  customerApiSecretEnvVar: z.string().trim().max(100),
  customerApiSendPhotos: z.boolean(),
}).strict().superRefine((data, context) => {
  if (!data.customerApiEnabled) return;
  const issue = (field: string, message: string) =>
    context.addIssue({ code: "custom", path: [field], message });
  try {
    const url = new URL(data.customerApiUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash) throw new Error();
  } catch {
    issue("customerApiUrl", "Enter a complete HTTP(S) endpoint without embedded credentials or a fragment.");
  }
  if (data.customerApiAuthType !== "none" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(data.customerApiSecretEnvVar)) {
    issue("customerApiSecretEnvVar", "Enter a server variable name, such as CUSTOMER_API_TOKEN—not a secret value.");
  }
  if (data.customerApiAuthType === "api_key" && data.customerApiKeyHeader &&
      !isCustomerKeyHeader(data.customerApiKeyHeader)) {
    issue("customerApiKeyHeader", "Enter a valid header name; Content-Type, Idempotency-Key and X-MeterFlo-Delivery-Id are reserved.");
  }
});
export type CustomerPushSettings = z.infer<typeof customerPushSchema>;

/** Only substitute defaults for legacy nulls; never merge general project fields. */
export function customerPushSettings(project: Record<string, any>): CustomerPushSettings {
  return {
    customerApiEnabled: project.customerApiEnabled ?? false,
    customerApiUrl: project.customerApiUrl ?? "",
    customerApiAuthType: project.customerApiAuthType ?? "none",
    customerApiKeyHeader: project.customerApiKeyHeader ?? "",
    customerApiSecretEnvVar: project.customerApiSecretEnvVar ?? "",
    customerApiSendPhotos: project.customerApiSendPhotos ?? true,
  };
}
