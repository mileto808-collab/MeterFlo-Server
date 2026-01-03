# Customer API Integration Guide

This guide explains how to configure MeterFlo to send completed work order data to your customer's backend systems via REST API.

---

## Overview

MeterFlo can automatically push work order data to external customer systems when:
- A meter changeout is completed from the mobile app
- Work order status changes to "Completed"

Each project can have its own API configuration, allowing you to integrate with multiple customer backends.

---

## Configuration

### Step 1: Navigate to Project Settings

1. Log in as an Administrator
2. Go to **Projects** in the sidebar
3. Click the **Edit** button on the project you want to configure

### Step 2: Enable Customer API

Scroll down to the **Customer API Integration** section and configure:

| Setting | Description |
|---------|-------------|
| **Enable Customer API** | Toggle to enable/disable API integration |
| **API Endpoint URL** | The URL where work order data will be POSTed |
| **Authentication Type** | How to authenticate with the customer API |
| **API Key Header Name** | Header name for API key (if using API Key auth) |
| **Secret Environment Variable** | Name of the env var containing the API secret |
| **Include Photos** | Whether to send photos as base64-encoded data |

### Step 3: Set Up Authentication

Choose an authentication type based on your customer's requirements:

#### No Authentication
Use for internal or trusted network endpoints.

#### API Key (Header)
- Set **Authentication Type** to "API Key (Header)"
- Enter the header name (e.g., `X-API-Key`)
- Set **Secret Environment Variable** to a name like `PROJECT_1_API_KEY`
- Add the actual API key to your server environment variables

#### Bearer Token
- Set **Authentication Type** to "Bearer Token"
- Set **Secret Environment Variable** to a name like `PROJECT_1_TOKEN`
- Add the actual token to your server environment variables
- MeterFlo will send: `Authorization: Bearer <token>`

#### Basic Authentication
- Set **Authentication Type** to "Basic Authentication"
- Set **Secret Environment Variable** to a name like `PROJECT_1_BASIC_AUTH`
- Store credentials in format `username:password` in the environment variable
- MeterFlo will Base64 encode and send: `Authorization: Basic <encoded>`

---

## Environment Variables

For security, API credentials are stored as environment variables on the server, not in the database.

### Windows Server (PM2)

Add to `deploy/ecosystem.config.cjs`:

```javascript
env: {
  NODE_ENV: 'production',
  PORT: 3000,
  // Customer API secrets
  PROJECT_1_API_KEY: 'your-api-key-here',
  PROJECT_2_TOKEN: 'your-bearer-token-here',
}
```

Then restart PM2:
```cmd
pm2 restart meterflo
```

### Replit

Add secrets in the Replit Secrets panel with the matching variable names.

---

## Payload Format

When a work order is completed, MeterFlo sends a JSON payload:

```json
{
  "workOrderId": 123,
  "customerWoId": "WO-2024-001",
  "status": "Completed",
  "oldMeterNumber": "12345678",
  "newMeterNumber": "87654321",
  "oldMeterReading": "10523",
  "newMeterReading": "0",
  "latitude": "39.7392",
  "longitude": "-104.9903",
  "gpsAccuracy": null,
  "serviceAddress": "123 Main Street",
  "serviceCity": "Denver",
  "serviceState": "CO",
  "serviceZip": "80202",
  "completedAt": "2025-12-28T14:30:00.000Z",
  "completedBy": "user-uuid-here",
  "notes": "Meter replaced successfully",
  "troubleCode": null,
  "serviceType": "Residential",
  "meterType": "AMI Smart Meter",
  "beforePhoto": "base64-encoded-image-data...",
  "afterPhoto": "base64-encoded-image-data...",
  "signature": "base64-encoded-signature-data..."
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `workOrderId` | number | MeterFlo internal work order ID |
| `customerWoId` | string | Customer's work order ID |
| `status` | string | Work order status ("Completed", "Trouble") |
| `oldMeterNumber` | string | Old meter serial number |
| `newMeterNumber` | string | New meter serial number |
| `oldMeterReading` | string | Final reading from old meter |
| `newMeterReading` | string | Initial reading on new meter |
| `latitude` | string | GPS latitude coordinate |
| `longitude` | string | GPS longitude coordinate |
| `gpsAccuracy` | string | GPS accuracy in meters |
| `serviceAddress` | string | Service location address |
| `serviceCity` | string | Service location city |
| `serviceState` | string | Service location state |
| `serviceZip` | string | Service location ZIP code |
| `completedAt` | string | ISO 8601 timestamp of completion |
| `completedBy` | string | User ID who completed the work |
| `notes` | string | Field notes |
| `troubleCode` | string | Trouble code if applicable |
| `serviceType` | string | Type of service |
| `meterType` | string | Type of meter installed |
| `beforePhoto` | string | Base64-encoded before photo (optional) |
| `afterPhoto` | string | Base64-encoded after photo (optional) |
| `signature` | string | Base64-encoded signature image (optional) |

---

## API Logging

All API calls are logged in the `customer_api_logs` table:

| Column | Description |
|--------|-------------|
| `id` | Log entry ID |
| `project_id` | Project ID |
| `work_order_id` | Work order ID |
| `customer_wo_id` | Customer work order ID |
| `request_url` | API endpoint URL |
| `request_method` | HTTP method (POST) |
| `request_payload` | JSON payload sent |
| `response_status` | HTTP response status code |
| `response_body` | Response body from customer API |
| `success` | Whether the call succeeded |
| `error_message` | Error message if failed |
| `retry_count` | Number of retry attempts |
| `created_at` | Timestamp of the API call |

### Viewing Logs

Query the logs via SQL:
```sql
SELECT * FROM customer_api_logs 
WHERE project_id = 1 
ORDER BY created_at DESC 
LIMIT 50;
```

---

## Expected Response

Your customer API should return:
- **2xx status code** for success
- Any other status code indicates failure

MeterFlo logs the response for debugging purposes.

---

## Troubleshooting

### API Calls Not Being Made

1. Verify **Enable Customer API** is turned on for the project
2. Check the **API Endpoint URL** is correct
3. Ensure the work order was marked as "Completed" (not "Trouble")

### Authentication Failures

1. Verify the environment variable name matches exactly
2. Check the secret value is correct
3. Restart PM2 after adding/changing environment variables
4. Check PM2 logs: `pm2 logs meterflo`

### Connection Errors

1. Verify the endpoint URL is reachable from the server
2. Check firewall rules allow outbound connections
3. For HTTPS endpoints, ensure SSL certificates are valid

### Checking Logs

View PM2 logs for API call information:
```cmd
pm2 logs meterflo --lines 100 | findstr CustomerAPI
```

Query the database for API log entries:
```sql
SELECT * FROM customer_api_logs 
WHERE success = false 
ORDER BY created_at DESC;
```

---

## Security Recommendations

1. **Use HTTPS** - Always use HTTPS endpoints for customer APIs
2. **Rotate Secrets** - Regularly rotate API keys and tokens
3. **Limit Access** - Use API keys with minimal required permissions
4. **Monitor Logs** - Regularly review API logs for failures or anomalies
5. **Test First** - Test with a staging endpoint before production

---

## Sample Customer API Implementation

Here's a simple Node.js/Express endpoint to receive MeterFlo data:

```javascript
const express = require('express');
const app = express();

app.use(express.json({ limit: '50mb' }));

app.post('/api/meterflo/work-orders', (req, res) => {
  const apiKey = req.headers['x-api-key'];
  
  if (apiKey !== process.env.EXPECTED_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const workOrder = req.body;
  
  console.log('Received work order:', workOrder.customerWoId);
  console.log('Status:', workOrder.status);
  console.log('New Meter:', workOrder.newMeterNumber);
  console.log('Completed At:', workOrder.completedAt);
  
  // Process photos if included
  if (workOrder.beforePhoto) {
    const photoBuffer = Buffer.from(workOrder.beforePhoto, 'base64');
    // Save or process the photo
  }
  
  // Update your database
  // ...
  
  res.json({ 
    success: true, 
    message: 'Work order received',
    workOrderId: workOrder.workOrderId 
  });
});

app.listen(3001, () => {
  console.log('Customer API listening on port 3001');
});
```

---

*Last updated: January 2026*
