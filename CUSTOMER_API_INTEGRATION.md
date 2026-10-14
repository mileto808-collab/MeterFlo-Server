# Customer API Integration

## Optional project inventory

Inventory-enabled push deliveries include an additive `inventory` snapshot: `contractVersion:1`, work-order allocation/use, exact serials, removed-equipment dispositions and referenced catalog items. Apply it under the existing idempotent delivery ID; it is not a command to change MeterFlo stock.

An enabled project's pull source may map `inventoryItems` to an array or JSON string, for example `[{"warehouseId":"warehouse-id","itemId":"item-id","quantity":1,"serials":["0000456"]}]`. Use MeterFlo IDs, not names/SKUs. Creation and reservation are atomic; invalid/unavailable stock rejects that row. Safe updates do not overwrite allocations. The importing actor needs inventory assignment and warehouse access. See [INVENTORY.md](INVENTORY.md) for full examples and backup/mobile rules.

MeterFlo sends completed work-order and trouble-report data to a customer's backend using HTTP POST. Delivery runs in a persistent PostgreSQL queue, with automatic retries, an admin retry action, and a log for each attempt.

MeterFlo also supports optional **inbound API Import**: pulling new work orders from a customer's JSON REST API using HTTP GET. Pull configuration is separate from outbound delivery. Either direction can be enabled without the other, and Excel/text uploads and direct database imports remain available.

This feature works on independent Windows or Linux installations. It does not require Replit, OpenID Connect, or a Replit login. MeterFlo users sign in through the application's local username/password session authentication.

## Guide navigation

- [Pull setup](#supported-contract-and-setup)
- [Every API Import field and option](#api-import-field-reference)
- [Every mapping target and safe-update checkbox](#mapping-targets-and-update-checkboxes)
- [Complete configurations and pagination examples](#complete-configurations-and-pagination-examples)
- [Incremental cursors and watermarks](#pagination-and-incremental-pulls)
- [Protected updates](#duplicate-matching-and-protected-updates)
- [Pull permissions, history, retries, and troubleshooting](#permissions-retries-and-troubleshooting)
- [Outbound push configuration](#push-completed-data-configure-a-project)
- [Outbound payload](#json-payload-contract)
- [Receiving and storing field images](#receiving-and-storing-field-images)
- [Image request limits and troubleshooting](#image-request-limits-and-troubleshooting)
- [Outbound administrator workflow](#administrator-workflow-and-troubleshooting)

## Pull work orders: API Import

### Supported contract and setup

Ask the customer for their API documentation and a sanitized response sample before configuring a real feed. The built-in importer supports HTTP(S) GET returning a JSON array, either at the response root or a configured dot-separated path. It does not support SOAP, GraphQL, OAuth authorization flows, attachment downloads, customer-side acknowledgments, or general two-way synchronization.

1. Sign in as an administrator and open a project's **Customer API** sidebar item, then select **Pull import**. The importer heading is **Customer API pull**. Existing `/projects/<id>/api-import` bookmarks still open the importer directly.
2. Choose **Add API source** (or **Set up first source** when empty), enter a name and endpoint URL, and configure authentication independently of the project's outbound settings.
3. Enter only the **name** of the server environment variable holding the credential. Configure its value on the MeterFlo server and restart the server to make new environment variables available. API key header, bearer token, Basic authentication, and no authentication are supported. Basic credentials use `username:password` as the environment variable's value.
4. Set the records path: leave blank for a root array, or use a path such as `data` or `result.workOrders`. Property names must use letters, digits, underscores, and hyphens; dots separate levels. Bracket-style array-index notation and property names containing dots are not supported.
5. Map **source property paths to MeterFlo target fields**. Map `customerWoId`, `customerId`, `customerName`, `address`, and `serviceType`; each is required on every imported record. Map a stable customer identifier, not a page position. IDs are never generated automatically for API pulls.
6. Use **Test & preview unsaved settings** in the dialog to inspect mapped values and validation errors. After saving, the source card has **Test / preview**. Preview fetches only the first page, without saved cursor/watermark checkpoints, and displays at most 20 records. It writes no work orders, checkpoints, or import runs and does not predict whether an existing order will be skipped by update protection.
7. Choose **Create source**, then **Pull now**. Runs are queued immediately and processed in the background; results appear in **Run history**. Start with manual scheduling (`0`) until the contract and a complete pull are verified; saving an enabled nonzero schedule starts the polling countdown without another confirmation.

Example customer response:

```json
{
  "data": [
    {
      "orderId": "0002042",
      "customer": { "id": "C-100", "name": "Sample customer" },
      "address": "123 Example Street",
      "service": "Water",
      "meter": { "id": "OLD-100", "reading": "12345678901234567890.001" }
    }
  ]
}
```

Use records path `data` and this mapping:

```json
{
  "orderId": "customerWoId",
  "customer.id": "customerId",
  "customer.name": "customerName",
  "address": "address",
  "service": "serviceType",
  "meter.id": "oldSystemId",
  "meter.reading": "oldSystemReading"
}
```

Service codes must match the project's configured service types (or global types if the project has no specific assignments). Old system/module product IDs must be assigned to that project. Unknown codes, missing required values, invalid GPS/email/decimal values, overlength values, and database uniqueness/foreign-key violations are reported, never silently defaulted. New records are **Open**; any supplied status must be the configured Open code. New-device readings/IDs/GPS, signatures, assignments, timing, and completion outcomes cannot be mapped through this importer.

Send identifiers and readings as **JSON strings** to retain leading zeros and exact decimal precision. Finite, safely representable JSON numbers are accepted, but precision already lost in a customer's JSON number cannot be recovered. Use numeric strings for large or high-precision values.

Captured reading text is also preserved in outbound delivery. For example,
`oldSystemReading: "00001.0012"`, `newSystemReading: "00000"`, and
`oldModuleReading: "00900719925474099312345.123456"` remain strings with exactly
those digits. The meter-named compatibility fields `oldMeterReading` and
`newMeterReading` use the same exact values as their system counterparts.
Store these fields in text columns in the customer's backend; convert a
separate copy only if calculations are required. Do not overwrite the original
with `parseFloat`, numeric database types, or padded/rounded formatting.
Historical readings without original text use the database numeric string;
previously lost zeros and previously generated delivery snapshots cannot be
reconstructed.

### API Import field reference

These labels match **Add customer API source** and **Edit API source**. Parenthesized keys are the stored configuration names, used by the complete JSON examples below. A placeholder is not a default: Source name, Endpoint URL, and Records path start blank. Hidden fields retain their settings when you change options and still undergo configuration validation; use the documented defaults for inactive options.

#### Source and scheduling

| Field | Use, default, and valid values | Example and how to use it |
| --- | --- | --- |
| Source name (`name`) | Required descriptive label; blank initially; trimmed, 1–150 characters. Not the customer order ID and need not be globally unique. | Enter `North district work orders` to recognize this source in cards and history; use a different descriptive name for the south district. |
| Endpoint URL (`endpoint`) | Required complete HTTP(S) GET URL, no default; at most 2,000 characters. No username/password, fragment, or credential-like query names. Redirects are not followed. | Enter `https://api.customer.example/v1/work-orders`; MeterFlo does not append a route. Use the final URL and HTTPS outside a trusted network. `https://user:pass@host/orders`, `#section`, and `?api_key=...` are invalid choices. |
| Records path (`recordsPath`) | Optional; default blank means the response itself is an array. Otherwise a dot-separated path, maximum 200 characters, resolving to an array. Segments use letters/digits/underscores/hyphens. | For `{"data":{"records":[]}}`, enter `data.records`. For the root-array example below, leave blank. This is a path in the whole response, not a path inside one work order. |
| Schedule (minutes) (`intervalMinutes`) | Required numeric control; default `0` means manual only. Whole numbers `15`–`43200` enable polling. `1`–`14`, fractions, and negatives are invalid. | Use `0` while testing; `15` every quarter hour, `60` hourly, `1440` every 24 hours. A `1440` schedule is not “midnight daily.” The first scheduled time is the save/enable time plus the interval; queuing any pull advances the next time by that interval. Runs cannot overlap for the same source. |
| Enabled (`isEnabled`) | Default on, **Scheduled / runnable**; off displays **Disabled**. On permits manual pulls and, if scheduled, polling; it does not override inactive-project or missing-database checks. | Leave on with Schedule `0` for manual pulls. Turn off to stop polling and cancel queued/retrying runs; a running page checks cancellation before writing. Previously committed data stays. Test / preview remains available while disabled. Turning on restarts the schedule countdown. **Current limitation: saving/toggling can reset saved incremental checkpoints**, as explained below. |

An active project with its own database is required for **Pull now** and **Retry run**. The MeterFlo server and PostgreSQL must remain running for automatic processing; keeping the browser open is not required. During an active run use the **source-card On/Off switch** to disable; a full edit/save, even with Enabled off, is rejected while that run is active.

#### Authentication

**Method** (`authType`) defaults to **None**. Select exactly the method specified by the customer's API; these authenticate MeterFlo's GET request to that backend, not users signing into MeterFlo.

| Method / stored value | When and how to use it | Fields shown and request example |
| --- | --- | --- |
| None / `none` | Use only when the feed intentionally allows unauthenticated GET requests, such as an access-controlled internal test feed. | No credential fields are shown. Request includes `Accept: application/json` and `Content-Type: application/json` but no authentication header. Example: select None for an anonymous test `/v1/work-orders` feed. |
| API key header / `api_key` | Use when the customer expects a static key in a custom request header. Configure the key value securely on the server, not in the form. | Set Server environment variable name to `CUSTOMER_API_KEY` and Request header to `X-API-Key` (or the customer's documented `X-Customer-Key`). Server sends `X-API-Key: <server-managed key>`. |
| Bearer token / `bearer_token` | Use a customer-issued static bearer credential. Token acquisition, OAuth login, refresh, and renewal are not performed by the importer. | Set Server environment variable name to `CUSTOMER_API_TOKEN`. Server sends `Authorization: Bearer <server-managed token>`; the variable must contain the token only, without the `Bearer ` prefix. |
| Basic authentication / `basic_auth` | Use when the customer expects HTTP Basic. Store `username:password` as one server variable and use HTTPS. | Set Server environment variable name to `CUSTOMER_API_BASIC`. A fictitious value `demo-user:demo-password` becomes `Authorization: Basic <base64 of demo-user:demo-password>`. Do not pre-base64 the variable or paste this value into the UI. |

| Conditional field | Requirement/default/format | Example and how to use it |
| --- | --- | --- |
| Server environment variable name (`secretEnvVar`) | Shown and required for every method except None; default blank. Maximum 100 characters; starts with uppercase letter/underscore and then uppercase letters/digits/underscores. The UI uppercases typing. Only the name is stored. | Enter `CUSTOMER_API_TOKEN`; a server administrator supplies its value to the MeterFlo process separately. `customer-token` is not a valid variable name. Leave unused with None. |
| Request header (`keyHeader`) | Shown/required for API key header only; default `X-API-Key`; maximum 100 characters, letters/digits/hyphens. Reserved names rejected during validation or request construction: Authorization, Host, Cookie, Connection, Content-Length, Accept, Content-Type, Proxy-Authorization, Idempotency-Key, X-MeterFlo-Delivery-Id (case-insensitive). | Use `X-Customer-Key` if that is what the customer specifies. Do not enter the key value here. For a standard Authorization bearer header select Bearer token instead. |

**Independent-server setup:** create the named variable in the environment of the actual account/service running MeterFlo, using the deployment's protected environment configuration. On Linux this might be a protected service EnvironmentFile or a locally maintained, permission-restricted PM2 environment file. On Windows it might be the service account environment or a protected PM2 environment loaded by that process. Never put real values in committed ecosystem files, documentation, URLs, or shell command examples. Restart the MeterFlo service/process with the updated environment; a variable in an unrelated terminal or desktop user account is insufficient. MeterFlo needs no Replit-managed login or secret service for this setup.

For example, arrange for the running process to receive variable **name** `CUSTOMER_API_BASIC` with the fictitious Basic format shown above, then choose Basic authentication and enter only `CUSTOMER_API_BASIC` in the form. Missing/empty values fail **before** a network request; inbound authentication/configuration errors do not automatically retry. Correct the environment, restart the process, and use administrator Retry run. An HTTP 401/403 means the backend rejected the request; check the method, header, variable, and customer credential permissions.

#### Mapping, filters, and incremental reads

| Field | Use, default, and constraints | Example and how to use it |
| --- | --- | --- |
| Field mapping JSON (`fieldMapping`) | Required JSON object of **source record path → MeterFlo target**. Initial `{"id":"customerWoId"}` is incomplete and cannot be saved/tested until all five required targets are present. Each target can appear only once; source paths are nonempty dot paths, maximum 200 characters. | Paste the seven-field mapping in the setup example above, after Records path selects the array. `customer.id` is relative to each record, not `data.0.customer.id`. See the full target reference below. |
| Query parameters JSON (`queryParams`) | Optional JSON object; default `{}` adds no static filters. Keys: 1–100 letters/digits/underscores/hyphens; values: strings, maximum 1,000 characters (empty string allowed). Credential-like names are rejected, including names containing password, secret, token, api-key/api_key, authorization, or credential. | Use `{"region":"north","include_open":"true"}`; the request gets `?region=north&include_open=true`. Use `"true"`/`"100"` rather than booleans/numbers. To remove static filters enter `{}`. Do not use arrays, trailing commas, comments, or a token here. |
| Watermark parameter (optional) (`watermarkParam`) | Optional name, default blank disables watermark use/storage. Maximum 100 letters/digits/underscores/hyphens; credential-like names invalid. Customer must support a UTC updated-since timestamp and inclusive, reliable semantics. It is not a date-value input. | Enter `updated_since` only if documented by the customer. First pull has no saved timestamp; after a fully successful run starting `2026-10-11T20:00:00.000Z`, the next first request carries `updated_since=2026-10-11T20%3A00%3A00.000Z`. See incremental rules below. |

Static query values replace matching parameters already in Endpoint URL. MeterFlo then sets page size for any paginated strategy, the starting page for Page number, saved cursor when enabled and present, and watermark when present, in that order. Those generated values replace same-named static values; use distinct parameter names. Without a checkpoint a static/endpoint parameter remains as configured, so **do not hard-code `cursor` or `updated_since` as a filter** when MeterFlo should manage it. Example: Page size `100` overrides static `"limit":"50"`. Cursor/page-number requests preserve filters; Next URL follows the customer's URL as supplied without reapplying filters or watermark to later pages, so its links must carry required parameters.

Paths such as `data.records`, `customer.id`, and `links.next` are supported. JSONPath (`$.data.records`), brackets (`records[0]`), wildcard notation, and property names containing literal dots are not supported. Numeric dot segments technically address own properties (including an array index), but Records path must resolve to the **whole records array**, not one indexed item; use object-property paths for interoperable feeds. Prototype/constructor paths are never traversed.

#### Pagination controls

**Strategy** (`pagination`) defaults to **None**. Choose based on the customer's documented response, not merely on the number of current work orders.

| Strategy / stored value | When to choose it and termination | Example |
| --- | --- | --- |
| None / `none` | The endpoint returns the complete array in one response; no generated page-size/page parameters. Stops after that response. | For a small root-array feed, choose None and leave Records path blank; Example A below creates one order. Do not choose None if more results are on another page. |
| Page number / `page` | Feed honors a page number and requested page size. Advances until fewer records than requested are returned (including an empty array). | Page parameter `page`, First page `1`, Page size parameter `limit`, Page size `2` produces pages 1, 2, and an empty page 3 for four records. Example B uses two records and two pages. |
| Cursor / `cursor` | Feed returns an opaque next cursor. Stops when the configured next value is missing, null, or `""`, not merely when the record array is short. | Cursor response path `paging.nextCursor`, Cursor query parameter `cursor`; a value `after-0002042` yields `?cursor=after-0002042`. Example C has two pages. |
| Next URL / `next_url` | Feed returns a next-link string. Stops on missing/null/empty next value. Each URL must remain on the endpoint's exact scheme, host, and port. | Next URL response path `links.next`; `/v1/work-orders?limit=2&offset=2` is accepted on the same origin. `https://other.customer.example/...` or HTTP instead of configured HTTPS is rejected. Example D follows a relative link. |

| Conditional control | Visibility, default, and accepted values | Example and how to use it |
| --- | --- | --- |
| Page parameter (`pageParam`) | Page number only; required, default `page`; 1–100 letters/digits/underscores/hyphens. | Enter `pageNumber` for a feed using `?pageNumber=1`. This is the name, not the page value. |
| First page (`startPage`) | Page number only; default `1`; whole number `0`–`1000000`. | Use `0` only for a zero-based customer API; requests become page 0, 1, 2. Use `1` for the examples below. Not an offset in records. |
| Page size parameter (`pageSizeParam`) | Shown for Page number; default `limit`; required 1–100 letters/digits/underscores/hyphens. The stored parameter is also sent on the first Cursor/Next URL request. | Use `pageSize` if the customer expects `?pageSize=100`, otherwise keep `limit`. |
| Page size (`pageSize`) | Shown for Page number; default `100`; whole number `1`–`1000`. Also used on the first Cursor/Next URL request, though hidden in those modes. | Set `2` for demonstration feeds, or `100` if the customer supports it. For Cursor/Next URL, set this and Page size parameter while Strategy is Page number, then switch Strategy; values are retained. Alternatively send the documented admin configuration JSON. |
| Cursor response path (`nextPath`) | Cursor only; required, no default; nonempty dot path, maximum 200 characters, relative to the entire response. | Enter `paging.nextCursor` for `{"paging":{"nextCursor":"after-0002042"}}`. A scalar string or safe integer is accepted; `0` is a cursor, not an end marker. Arrays/objects/booleans are rejected; next values cannot exceed 2,000 characters. |
| Next URL response path (`nextPath`) | Next URL only; required, no default; nonempty dot path, maximum 200 characters, relative to the entire response. | Enter `links.next` for `{"links":{"next":"/v1/work-orders?offset=2"}}`. The returned value must be a string; resolve relative links against the current page. No credentials/fragments, cross-origin links, or HTTP redirects. |
| Cursor query parameter (`cursorParam`) | Cursor only; required, default `cursor`; 1–100 letters/digits/underscores/hyphens. | Enter `after` if the backend expects `?after=after-0002042`; do not paste the actual cursor value into this control. |
| Resume saved cursor (`resumeCursor`) | Cursor only; default off. Off restarts at the endpoint on each new pull. On starts future pulls from a last-successful cursor when one exists. Not valid for other strategies. | Leave off for expiring snapshot cursors. Turn on only for a customer-documented durable cursor; Example C shows why its final page may be replayed. Turn it off before switching to another strategy. |

Parameter names must follow the customer's contract and must not carry credentials. Keep inactive pagination fields at their valid defaults. If the customer caps responses below the requested page size, Page number would stop early: set a page size it actually honors. Cursor and Next URL terminate from next metadata even on an empty page. Repeated URLs/cursors fail as a pagination loop before writing that looping page.

#### Update behavior

| Option/control | Default and eligibility | Example and how to use it |
| --- | --- | --- |
| Create-only (recommended) (`updateMode: "create_only"`) | Default. Stable customer work-order ID matches within this project; existing IDs are skipped, never overwritten. New valid records are created with all mapped baseline values. | Pull `0002042` twice: first run creates it, second skips it even if the incoming address changed. Choose this when the feed is an order-creation list or technicians may already be working. |
| Safe update selected fields (`updateMode: "safe_update"`) | Opt-in. Shows baseline checkboxes, initially all unchecked. At least one must be selected; only API-created, untouched Open records with matching saved versions are eligible. New IDs still create with **all** mapped values; checkboxes limit updates, not creates. | Select Address and Old system reading for incoming address corrections. An eligible `0002042` can change from `123 Example Street` to `456 Example Street`; a later API-only correction can update it again. A technician edit protects the entire existing order. |
| Baseline field checkboxes (`updateFields`) | Shown only for Safe update selected fields; default `[]`. Schema permits at most 20 entries; the UI offers the 18 fields marked Yes in the target table. Selection does not supply a mapping or override required-record validation. | Check Address only and map the address source path. A changed Phone is preserved because Phone is not checked. Uncheck Address to stop changing it, but select another field or return to Create-only before saving. |

See the target table for an individual example/use of every checkbox. Customer work-order ID, Status, and Notes have no safe-update checkbox. A supplied Note on creation protects that order from later safe updates; do not map a nonempty baseline note if you expect it to remain eligible.

### Mapping targets and update checkboxes

Each target below is a valid mapping value; source keys are customer-specific. Required targets must be mapped **and nonempty on every record**, even when safe-updating only one field. Maximums are string lengths after trimming; ordinary strings/numbers are accepted, but nested objects, arrays, and booleans are not. Other than readings, JSON numbers must be safe integers; send IDs and readings as strings.

“Safe update: Yes” identifies a checkbox with the same label. Check it only if the customer is authoritative for that baseline field; an eligible existing record changes only if the source value is present and different. Leave it unchecked to retain the existing value. The examples are fictitious, and product/service codes must be replaced by actual project codes.

| UI label / target | Required / maximum characters | Example value and how to use it | Safe update |
| --- | --- | --- | --- |
| Customer work-order ID / `customerWoId` | Yes / 100 | `"0002042"`: map `orderId`; stable external order key for deduplication within a project, never a page index. No slash/backslash or sole `"."`/`".."`; cannot be renamed by import. | No |
| Customer ID / `customerId` | Yes / 100 | `"C-100"`: map `customer.id`; identify the customer, not the MeterFlo user. Check Customer ID for permitted baseline customer-reference corrections. | Yes |
| Customer name / `customerName` | Yes / 100 | `"Sample customer"`: map `customer.name`; check Customer name for customer-supplied spelling corrections. | Yes |
| Address / `address` | Yes / 500 | `"123 Example Street"`: map `address`; service street address. Check Address for corrected premises on an untouched order. | Yes |
| City / `city` | No / 100 | `"Example City"`: map `location.city`; check City for baseline city corrections, not a GPS value. | Yes |
| State / region / `state` | No / 50 | `"CO"`: map `location.state`; check State / region to update a region code/name from the customer. | Yes |
| ZIP / postal code / `zip` | No / 20 | `"00801"`: map `location.postalCode` as a string to preserve zeros; check ZIP / postal code for corrections. | Yes |
| Phone / `phone` | No / 50 | `"+1-555-0100"`: map `customer.phone` as text; check Phone to refresh the baseline contact number. No importer-specific phone pattern. | Yes |
| Email / `email` | No / 100 | `"sample@example.invalid"`: map `customer.email`; requires a basic non-whitespace `name@domain.suffix` form. Check Email for contact corrections. | Yes |
| Route / `route` | No / 100 | `"NORTH-01"`: map `routeCode`; check Route to update a baseline routing label, not a technician assignment. | Yes |
| Zone / `zone` | No / 100 | `"ZONE-A"`: map `zoneCode`; check Zone for geographic/service-area classification. | Yes |
| Service type / `serviceType` | Yes / 50 | `"Water"` only if this is an actual eligible service **code**, not a display label. Map `service`; check Service type for permitted baseline recategorization. Uses assigned project codes, or global codes if none are assigned; it is never inferred automatically for API Import. | Yes |
| Old system ID / `oldSystemId` | No / 100 | `"OLD-100"`: map `meter.id`; check Old system ID to correct the expected existing meter ID, not a newly installed ID. | Yes |
| Old system reading / `oldSystemReading` | No / 100 | `"12345678901234567890.001"`: map `meter.reading` as an exact decimal string. Check Old system reading only for authoritative baseline readings, never to overwrite technician captures. | Yes |
| Old GPS / `oldGps` | No / 100 | `"40.7128,-74.0093"`: map `location.gps`; exactly latitude,longitude with ranges ±90/±180. Check Old GPS to correct baseline location, not New GPS. | Yes |
| Inventory assignments / `inventoryItems` | No / 100000 | `"[]"` or an array containing `"warehouseId"`, `"itemId"`, `"quantity"` and `"serials"` as shown above; available only with inventory enabled. API safe updates do not overwrite allocations | No |
| Old system type / `oldSystemType` | No / 100 | `"SYS-W1"`: map `meter.productId`; must be a system **product ID assigned to this project**. Check Old system type for baseline model corrections; do not send a friendly model label. | Yes |
| Old module ID / `oldModuleId` | No / 100 | `"RADIO-100"`: map `module.id`; check Old module ID to correct the expected existing radio/module identifier. | Yes |
| Old module reading / `oldModuleRead` | No / 100 | `"0.001"`: map `module.reading`; target is exactly `oldModuleRead`, not outbound `oldModuleReading`. Check Old module reading for baseline reading corrections. | Yes |
| Old module type / `oldModuleType` | No / 100 | `"MOD-W1"`: map `module.productId`; must be a module **product ID assigned to this project**. Check Old module type for a baseline model correction. | Yes |
| Status / `status` | No / 50 | `"Open"` only when this is the configured Open status code. Omit mapping or send null/empty to use that code automatically. Any supplied non-Open or unknown code fails the record; custom “default” status is not used. | No |
| Notes / `notes` | No / 10000 | `"Access via north gate"`: map `instruction` only to create a baseline note on new orders. Existing notes/reset history are never replaced or appended through safe update; a nonempty note protects the order. | No |

Decimal strings allow optional sign and a decimal point, e.g. `"0"`, `"-0.001"`, `"12.5"`; scientific notation (`"1e3"`), thousands separators, and units are invalid. Safely bounded decimal JSON numbers are accepted only for the two reading targets; string values preserve precision before JSON parsing. Database column constraints still apply after mapping (including uniqueness/foreign keys); a validation preview is not a guarantee of successful storage.

On a new record, omitted optional fields use normal database defaults/nulls; mapped null/`""` becomes null (Status still becomes Open). On an eligible safe update, an **absent** optional source property leaves the previous value alone, while explicit null/`""` clears a selected optional field. For example, with Phone selected, no `customer.phone` preserves `"+1-555-0100"`; `"phone":null` clears it. Empty Address or missing Customer ID fails validation rather than clearing a required field.

Only the five required plus sixteen optional targets above are supported. Do not map internal IDs, new system/module IDs/types/readings, New GPS, signatures, photos/files, assignments/groups, schedules, trouble/completion outcomes, time tracking, or actor/timestamp fields. Unexpected target names make the configuration invalid; use MeterFlo's technician/work-order workflow for those values.

### Complete configurations and pagination examples

All URLs below are non-routable examples, not a real customer connection. Configure an **active test project** with service code `Water` (or replace that value with an existing assigned code), and securely provision fictitious test credentials only on a mock backend if testing authentication. Never enable scheduled production pulls from these examples.

The configuration blocks are complete **admin REST settings objects**, accepted by `POST /api/projects/:projectId/api-import/configs` using a signed-in local administrator session. There is no whole-configuration JSON paste control in the form: enter the corresponding values manually and paste only `fieldMapping` and `queryParams` into their own JSON textareas. Leave Schedule `0` initially. For Cursor/Next URL page-size changes, follow the temporary Page number selection described above.

For each example: enter settings → **Test & preview unsaved settings** → inspect Valid / Needs attention → **Close** → **Create source** → **Pull now** → inspect **Run history**. A saved source can be retested using **Test / preview**. No actual import occurs until a pull is queued (or an enabled schedule comes due).

#### Example A: None authentication, None pagination, root array

Use this for a complete, unauthenticated mock feed. Records path is blank.

```json
{
  "name": "Example A manual root feed",
  "endpoint": "https://api.customer.example/v1/work-orders",
  "authType": "none", "secretEnvVar": "", "keyHeader": "X-API-Key",
  "recordsPath": "",
  "fieldMapping": {"orderId":"customerWoId","customer.id":"customerId","customer.name":"customerName","address":"address","service":"serviceType","meter.id":"oldSystemId","meter.reading":"oldSystemReading"},
  "queryParams": {}, "watermarkParam": "",
  "pagination": "none", "pageParam": "page", "startPage": 1,
  "pageSizeParam": "limit", "pageSize": 100, "nextPath": "",
  "cursorParam": "cursor", "resumeCursor": false,
  "intervalMinutes": 0, "isEnabled": true,
  "updateMode": "create_only", "updateFields": []
}
```

Mock response to `GET /v1/work-orders`:

```json
[
  {"orderId":"0002042","customer":{"id":"C-100","name":"Sample customer"},"address":"123 Example Street","service":"Water","meter":{"id":"OLD-100","reading":"12345678901234567890.001"}}
]
```

Preview: 1 sampled / 1 valid, no records written. First pull: succeeded, 1 created / 0 updated / 0 skipped / 0 failed, 1 page. Repeat: succeeded, 1 skipped. These counts assume an empty test project and valid project codes/constraints.

#### Example B: API key header, Page number, nested records

Use for an API honoring `page` and `limit`. Select API key header, enter variable name `CUSTOMER_API_KEY`, and choose Page number with size `2`. Static region filtering is preserved on later pages.

```json
{
  "name": "Example B north page feed",
  "endpoint": "https://api.customer.example/v1/work-orders",
  "authType": "api_key", "secretEnvVar": "CUSTOMER_API_KEY", "keyHeader": "X-Customer-Key",
  "recordsPath": "data.records",
  "fieldMapping": {"orderId":"customerWoId","customer.id":"customerId","customer.name":"customerName","address":"address","service":"serviceType","meter.id":"oldSystemId","meter.reading":"oldSystemReading"},
  "queryParams": {"region":"north"}, "watermarkParam": "",
  "pagination": "page", "pageParam": "page", "startPage": 1,
  "pageSizeParam": "limit", "pageSize": 2, "nextPath": "",
  "cursorParam": "cursor", "resumeCursor": false,
  "intervalMinutes": 0, "isEnabled": true,
  "updateMode": "safe_update", "updateFields": ["address","oldSystemReading"]
}
```

First request: `GET /v1/work-orders?region=north&limit=2&page=1`, header `X-Customer-Key: <server-managed key>`.

```json
{
  "data": {"records": [
    {"orderId":"0002043","customer":{"id":"C-101","name":"Example one"},"address":"125 Example Street","service":"Water","meter":{"id":"OLD-101","reading":"0.001"}},
    {"orderId":"0002044","customer":{"id":"C-102","name":"Example two"},"address":"127 Example Street","service":"Water","meter":{"id":"OLD-102","reading":"12.5"}}
  ]}
}
```

Second request keeps region/limit and changes `page=2`; mock response:

```json
{"data":{"records":[]}}
```

It stops because 0 < Page size 2. Preview samples the two first-page records and reports more available because a full page requires another fetch. First pull creates 2 and counts 2 pages (including the empty page). Another identical pull skips 2. If this API instead starts at zero, set First page `0` and serve the same first response for `page=0`, then empty for `page=1`.

For an update demonstration, change the source address for `0002043` to `"129 Example Street"` without editing its MeterFlo order. The next run updates 1 and skips the unchanged other order; a later source-only change can update again. Phone cannot change because it is not selected. Assigning the order or adding a note in MeterFlo causes subsequent customer corrections to skip it.

After successful test pulls, an administrator may change Schedule to `60` for hourly polling. This is optional; saving that changed setting clears saved incremental checkpoints even if other settings are unchanged.

#### Example C: Bearer token, Cursor, optional watermark

Use only when the customer documents `paging.nextCursor` and inclusive `updated_since` UTC filtering. Set size `2` while Page number is selected, then switch to Cursor and fill the cursor controls. Enable Resume saved cursor only if the customer explicitly guarantees durable cursors **and** compatibility with updated-since filtering; otherwise leave it off. The example leaves it off.

```json
{
  "name": "Example C incremental cursor feed",
  "endpoint": "https://api.customer.example/v1/work-orders",
  "authType": "bearer_token", "secretEnvVar": "CUSTOMER_API_TOKEN", "keyHeader": "X-API-Key",
  "recordsPath": "data.records",
  "fieldMapping": {"orderId":"customerWoId","customer.id":"customerId","customer.name":"customerName","address":"address","service":"serviceType","meter.id":"oldSystemId","meter.reading":"oldSystemReading"},
  "queryParams": {}, "watermarkParam": "updated_since",
  "pagination": "cursor", "pageParam": "page", "startPage": 1,
  "pageSizeParam": "limit", "pageSize": 2, "nextPath": "paging.nextCursor",
  "cursorParam": "cursor", "resumeCursor": false,
  "intervalMinutes": 0, "isEnabled": true,
  "updateMode": "create_only", "updateFields": []
}
```

First-ever request: `GET /v1/work-orders?limit=2`, header `Authorization: Bearer <server-managed token>`. A short array does not stop cursor pagination:

```json
{
  "data":{"records":[{"orderId":"0002045","customer":{"id":"C-103","name":"Example three"},"address":"131 Example Street","service":"Water","meter":{"id":"OLD-103","reading":"0.002"}}]},
  "paging":{"nextCursor":"after-0002045"}
}
```

Second request: `GET /v1/work-orders?limit=2&cursor=after-0002045`:

```json
{
  "data":{"records":[{"orderId":"0002046","customer":{"id":"C-104","name":"Example four"},"address":"133 Example Street","service":"Water","meter":{"id":"OLD-104","reading":"0.003"}}]},
  "paging":{"nextCursor":null}
}
```

First pull creates 2 in 2 pages; preview shows just 1 sampled / 1 valid with more available. If the successful run started at `2026-10-11T20:00:00.000Z`, the next first request adds the URL-encoded `updated_since` timestamp shown in the field reference. It starts without a saved cursor because Resume saved cursor is off.

For a **durable-cursor-only** variation, clear Watermark parameter, turn Resume saved cursor on, and save before another pull; the setting edit clears old checkpoints. After that fully successful two-page run, `after-0002045` is saved. The next pull begins at the final-page cursor, which can replay `0002046`; Create-only skips it. The importer does not save a null terminal cursor as an “after all orders” marker. Never enable this on expiring cursors.

#### Example D: Basic authentication, Next URL

Use when the customer provides next links on the same origin. Set Basic authentication and variable name `CUSTOMER_API_BASIC` (server value format `username:password`). Set Page size `2` before switching Strategy to Next URL.

```json
{
  "name": "Example D next-link feed",
  "endpoint": "https://api.customer.example/v1/work-orders",
  "authType": "basic_auth", "secretEnvVar": "CUSTOMER_API_BASIC", "keyHeader": "X-API-Key",
  "recordsPath": "data.records",
  "fieldMapping": {"orderId":"customerWoId","customer.id":"customerId","customer.name":"customerName","address":"address","service":"serviceType","meter.id":"oldSystemId","meter.reading":"oldSystemReading"},
  "queryParams": {}, "watermarkParam": "",
  "pagination": "next_url", "pageParam": "page", "startPage": 1,
  "pageSizeParam": "limit", "pageSize": 2, "nextPath": "links.next",
  "cursorParam": "cursor", "resumeCursor": false,
  "intervalMinutes": 0, "isEnabled": true,
  "updateMode": "create_only", "updateFields": []
}
```

First request: `GET /v1/work-orders?limit=2`, header `Authorization: Basic <base64 of server-managed username:password>`:

```json
{
  "data":{"records":[{"orderId":"0002047","customer":{"id":"C-105","name":"Example five"},"address":"135 Example Street","service":"Water","meter":{"id":"OLD-105","reading":"0.004"}}]},
  "links":{"next":"/v1/work-orders?limit=2&offset=2"}
}
```

Second request: `GET /v1/work-orders?limit=2&offset=2` on **https://api.customer.example**, with the same Basic header:

```json
{
  "data":{"records":[{"orderId":"0002048","customer":{"id":"C-106","name":"Example six"},"address":"137 Example Street","service":"Water","meter":{"id":"OLD-106","reading":"0.005"}}]},
  "links":{"next":""}
}
```

Stops at the empty next link, creating 2 in 2 pages. An absolute next link on the same exact origin is also supported; a different port, host, scheme, fragment, or credentials fails. The next link must include all filters needed for the second page; MeterFlo does not append the first request's query settings to it.

### Pagination and incremental pulls

| Mode | Behavior |
| --- | --- |
| None | Import the single returned array. Do not select this for a paginated feed. |
| Page number | Send the configured page parameter, starting page, and page-size parameter. Increment the page until the returned array contains fewer than the requested page size. The customer's API must honor that page size. |
| Cursor | Read the next cursor from the configured response path and send it using the configured cursor query parameter. Missing, null, or empty next values end the run. |
| Next URL | Read a URL from the configured response path. Relative URLs resolve against the current page; every URL must remain on the original endpoint's exact origin. Missing, null, or empty values end the run. |

Non-credential query parameters support customer filters. Credentials must not be placed in URLs or query parameters; authentication uses headers populated server-side. HTTP redirects are rejected, including same-origin redirects. Use HTTPS outside a trusted network.

**Resume saved cursor** is optional and only supported with cursor pagination. A successful run saves the last next cursor encountered; later runs may replay the final page. Stable ID matching makes this safe. Enable only if the customer documents durable cursors suitable for later polling; cursors tied to an expiring snapshot are not suitable.

An optional **watermark query parameter** sends the last successful run's MeterFlo start timestamp (UTC). On complete success the watermark advances to the new run's start timestamp, not the last fetched page. The customer must support this timestamp format and appropriate inclusive updated-since semantics; eventually consistent feeds may require an adapter/overlap strategy. Partial errors, failed fetches, cancellation, and interruption never advance the configured watermark/cursor. Retrying an unsuccessful run starts from its original checkpoint using current configuration, provided the endpoint and pagination mode have not changed.

**Current checkpoint-reset limitation:** editing settings resets the saved cursor/watermark. The current settings comparison is sensitive to stored JSON property ordering, so even saving unchanged settings or toggling Enabled can clear these checkpoints. Do not rely on pause/resume preserving them. After a toggle, a new pull may reread the full feed; stable IDs and the update protections still prevent duplicate creation or overwriting protected work. A manual retry can still use its prior run's original checkpoint when endpoint/pagination are unchanged. This is separate from successful-run checkpoint advancement; resetting a source does not erase imported orders or run history.

Limits: 30 seconds per HTTP fetch, 5 MiB per response page, 1,000 records per page, 100 pages and 50,000 records per run. Pagination loops and unsupported shapes fail explicitly. Split larger feeds with customer filters or provide a suitable adapter.

### Duplicate matching and protected updates

- **Create only** is the default. A work order with the same `customerWoId` in that project is skipped. Missing records in the feed never cause local deletion.
- **Safe update** is an explicit opt-in allowlist of baseline fields. It only updates Open work orders **originally created by API Import**, whose saved row version still matches. Any edit outside API Import protects that record, even if no editor name was recorded. File-imported or manually created existing work orders are skipped.
- Notes (including reset history), assignment, scheduling, trouble/completion, new-device data, signatures, attachments/photos (including legacy folders), or time tracking also protect a record. Notes and status are not eligible for baseline updates.
- Only selected baseline fields actually present in the record are changed. Unmapped/absent values are preserved; explicit null/empty optional fields can clear a selected baseline value. Required values cannot be cleared.
- Each page's successful writes and progress counters commit together. Invalid records are reported while other valid records on the page may import. Previously committed pages remain if a later page fails.
- Imported creates/updates never enqueue outbound completion deliveries. Existing completion/trouble workflows still use their normal outbound queue.

### Permissions, retries, and troubleshooting

Administrators configure, edit, disable, and remove sources; removal needs confirmation and retains work orders and historical runs. Active sources cannot be edited/removed until the run finishes or is disabled and cancellation completes.

Non-admin users need **`project.apiImport`** and assignment to the project to view history, preview an already configured source, and use Pull Now. They cannot configure endpoints, preview arbitrary unsaved endpoints, remove sources, or retry failed runs. Administrators alone can retry unsuccessful history entries with a still-existing configuration. A retry creates a separate audited run; it does not erase the original failure.

The permission appears as **Customer API Import** under **Project Menu** in role management. It is enabled for administrators by default, and disabled for the other default roles; administrators must grant it explicitly when non-admin access is desired.

To grant operator access: **Settings → Access Levels → Edit** the relevant non-admin access level → **Project Menu → Customer API Import** → **Update**, then assign that user (directly or through a group) to the project. For example, a project-assigned Viewer with that grant can test a saved source and pull it, but cannot add/edit/remove sources or retry history. Documentation downloads themselves are administrator-only; share an approved guide with operators as appropriate.

#### Operator actions and examples

| Action | How and when to use it | Example result / limits |
| --- | --- | --- |
| Add API source / Set up first source | Administrator opens the configuration dialog and fills all mandatory fields/mappings. | Enter Example A; nothing is imported merely by opening the dialog. |
| Test & preview unsaved settings | Administrator tests the current draft before saving. | Example B shows 2 sampled / 2 Valid and more available; missing customer IDs show Needs attention. Close returns to the unchanged draft. Only the first page is tested, never later pages or saved checkpoints. |
| Create source / Save changes | Administrator validates and persists the current settings; waits until no active run before full edits. | Create Example A and see its source card. Saving Example B with Schedule `60` enables its future polling countdown; saving can clear checkpoints. There is no separate production activation step. |
| Cancel / Close | Cancel dismisses the editor without saving; Close dismisses the preview. | An unsaved endpoint change is discarded with Cancel; an already performed read-only customer GET cannot be undone, but no work orders were written. |
| Test / preview | Anyone with allowed project access tests a saved source. | A disabled source can still be previewed; a backend 401 shows Preview failed immediately, with no retry/run-history entry. |
| Pull now | Allowed project user queues an enabled source on an active project with a database. | Example A reports Import queued then progresses in history. A second active pull for the same source is rejected instead of running in parallel. Preview success is not required/enforced before pulling. |
| On / Off switch | Administrator disables or re-enables a saved source. | Off cancels a queued retry; committed earlier pages remain. A running page checks for cancellation before writes. On permits future pulls and restarts any schedule; observe the checkpoint-reset warning above. |
| Edit (code icon) | Administrator adjusts the source after its active run ends or is disabled and cancellation completes. | Correct Records path from `data.items` to `data.records`, preview, then Save changes. A running run retains its original settings; editing it is blocked. |
| Remove (trash icon) → Keep source / Remove source | Administrator confirms removal of a connection, not its imported work. Disable and wait if active. | Keep source cancels removal. Remove source retains work orders and historical counts/messages; those history entries can no longer be retried without an existing configuration. Create a new source to import again. |
| Retry run (source card) / Retry (history row) | Administrator queues a **new** audited run for partial/failed/interrupted/cancelled history whose source still exists. Source must be enabled, project active, and no run already active. | Fix a 401 credential on the server and restart, then retry. The original failed run remains. Previously committed IDs skip or receive eligible safe updates on replay. Succeeded/active runs cannot be retried. |
| Issues / notes button | Expand the history row's diagnostic messages with page/row coordinates and actions. | `1 issues` may show `page 1 · failed · Customer API returned HTTP 401`; correct authentication. A skipped protected-order message explains why a baseline correction was not applied. |
| Refresh / Newer / Older | Refresh reloads source/history data; history pages contain 25 entries, with Older enabled when the page is full and Newer when not at the first page. | Use Older to inspect an earlier failure, then Newer to return. Active run data also refreshes about every 5 seconds while visible. |

#### Run-history examples

| Status | Meaning and example | What to do |
| --- | --- | --- |
| queued | Awaiting a worker/page; e.g. Pull now accepted or the next page is due. | Wait for background processing; no parallel pull for this source. |
| running | Worker processing a page. | Keep the server running; browser may be closed. |
| retrying | Transient fetch failed; e.g. HTTP 503. | Expand issues to see Next retry; automatic attempts persist. Do not try to manually retry an active run. |
| succeeded | Every record validated/stored or safely skipped; e.g. Example A repeated gives 1 skipped. | Inspect counts; success does not mean every incoming row was created or updated. |
| partial | Record failures alongside created/updated/skipped rows; e.g. 1 created and 1 failed missing Customer ID. | Fix source data/mapping then administrator retry; successful pages remain and checkpoints did not advance. |
| failed | Fetch/configuration/storage failure, or no successful/skipped records alongside record errors. E.g. HTTP 401 may have 0 failed **records**. | Read status and issues, correct the cause, then administrator retry. A fully rejected record set is failed, not partial. |
| interrupted | A stale running claim is recovered after the worker stops (approximately two minutes, once no worker lock remains). | Restart/check server/database, then administrator retry. Do not assume uncommitted work completed. |
| cancelled | Source disabled or project inactive before a page write. | Re-enable/activate as appropriate; administrator can retry. Prior committed pages are not rolled back. |

Runs display queued/running/retrying/succeeded/partial/failed/interrupted/cancelled status, page and fetch counts, created/updated/skipped/failed record counts, and up to 100 diagnostic messages. Error messages take priority over skipped-record examples (at most 50 skip examples). A page-fetch failure can fail the run while the record-failure count remains zero; inspect the run status and messages, not just the counters. Remote error response bodies, credential values, and SQL parameters are not logged.

Connection failures, HTTP 408/429, and HTTP 5xx receive up to **four total attempts per page**, with persistent retry delays of 1, 5, and 15 minutes. `Retry-After` can extend these delays, capped at 24 hours. Authentication/configuration/validation failures stop without network retries. Preview reports errors immediately without retrying.

Per-configuration database locks and an active-run constraint prevent overlapping runs. Queued/retrying pages and scheduled polling survive server restarts. A worker interrupted during a page becomes **interrupted** after approximately two minutes and can be retried manually from its original checkpoint. Disabled configurations cancel queued/retrying runs immediately; a currently processing page checks for cancellation before writing. Inactive projects do not poll and cancel pending processing at a page boundary.

If importing fails, check records path, mapping, service/product codes, pagination contract, server network access, and the named server environment variable. Configure the corrected source after the active run ends, then retry. If the source has been removed, create a new configuration instead. No real customer feed compatibility is implied by the example above; validate the customer's test endpoint before enabling scheduled production pulls.

### Inbound administration endpoints

All endpoints are session-authenticated and project-scoped under `/api/projects/:projectId/api-import`:

| Method and path suffix | Purpose |
| --- | --- |
| `GET /configs` | List configurations and latest run summaries. |
| `POST /configs` | Admin: create configuration. |
| `PATCH /configs/:id` | Admin: edit or disable configuration. Settings saves can reset saved cursor/watermark, including enable/disable in the current implementation; see the checkpoint-reset warning. |
| `DELETE /configs/:id` | Admin: remove an inactive configuration, retaining work orders/history. |
| `POST /preview` | Admin: preview unsaved complete settings. |
| `POST /configs/:id/preview` | Preview an existing configured source without a request body. |
| `POST /configs/:id/run` | Queue Pull Now; returns HTTP 202 and run summary. |
| `GET /runs?limit=25&offset=0` | History; limit 1–100. |
| `POST /runs/:runId/retry` | Admin: queue a new retry run for failed/partial/interrupted/cancelled history. |

## Push completed data: configure a project

1. Create the project first if necessary. Project create/edit now links to the canonical integration page instead of maintaining a second editable form.
2. Open **Customer API → Push delivery** in the project's menu. Push and **Pull import** are independent: enabling or saving one never enables, edits, or removes the other.
3. Enter the receiving URL, choose authentication, and set the photo preference. If authentication is required, configure the named variable through the server's secure environment configuration and restart the server process so it can read it.
4. Turn on **Enable outbound delivery**, then choose **Save push settings**. Incomplete settings can be saved while disabled. Enabled settings must pass validation, including server-side credential availability; this is not a connection test and sends no customer request.

### Push delivery field reference

| UI field / stored column | Use and requirements | Example and how to use it |
| --- | --- | --- |
| Enable outbound delivery / `customer_api_enabled` | Default false. Records new completed/trouble delivery events only when enabled. Existing pending work pauses while disabled and resumes after re-enabling. No backfill is performed. | Leave off while configuring; turn on and **Save push settings** once the endpoint/credentials are ready. Turn off and save to pause future delivery. This switch does not disable pull sources. |
| Customer endpoint URL / `customer_api_url` | Maximum 500 characters. Enabled delivery requires a complete HTTP(S) URL without embedded username/password or a fragment. POST/JSON is fixed; redirects are not followed. Use HTTPS outside a trusted network and keep credentials out of URLs. | `https://api.customer.example/v1/completions` receives MeterFlo's fixed work-order payload. Enter the full receiving path, not merely the customer's home page. Blank or `not-a-url` can be retained while disabled, but cannot be enabled. |
| Authentication / `customer_api_auth_type` | One of No authentication (`none`), API key header (`api_key`), Bearer token (`bearer_token`), Basic authentication (`basic_auth`). Default None. Select the customer's actual supported method. | Choose **Bearer token** for an API requiring `Authorization: Bearer ...`; choose **No authentication** only for a deliberately unauthenticated endpoint. Conditional fields below follow this selection. |
| API key header name / `customer_api_key_header` | Shown for API key header only. Maximum 100 characters. Blank means `X-API-Key`. HTTP token characters are accepted; Content-Type, Idempotency-Key and X-MeterFlo-Delivery-Id are reserved, case-insensitively. | Leave blank for `X-API-Key`, or enter `X-Customer-Key` if the customer's contract requires it. Enter a header name, never its secret value. `Bad Header` and `Idempotency-Key` cannot be used when enabled. |
| Server environment variable name / `customer_api_secret_env_var` | Shown for authenticated modes. Maximum 100 characters; enabled authentication requires letters/digits/underscores, beginning with a letter or underscore. Names retain their case, preserving existing mixed-case references; match the actual server variable exactly. The named variable must be populated. | Enter `CUSTOMER_API_TOKEN` for Bearer authentication, `CUSTOMER_API_KEY` for an API key, or `CUSTOMER_API_BASIC` for Basic. Set its value separately in the Windows/Linux service or PM2 environment; never paste a password/token into this field. |
| Include field images / `customer_api_send_photos` | Default true. Includes before, after, trouble, signature and other image files, plus signature image data. Off omits image bytes/signature data; attachment filenames and signature name remain. Applies when a delivery's payload is first prepared; prepared retry payloads remain unchanged. | Leave on if the customer accepts base64 images. Turn off and save for a JSON-only integration that does not accept image bytes. Changing this option does not rebuild previously prepared deliveries. |

**Save behavior and credential status:** Only the six push fields are submitted; unrelated project details and pull sources remain intact. **Last-saved credential availability** reports available, missing, or not required for the saved selection, without showing values. It does not verify unsaved edits or customer acceptance. A syntactically valid variable name is not proof that the variable exists: enabled saves reject a missing server variable with a field error. If an installed server later loses its variable, existing deliveries still fail safely and retry—there is no unauthenticated fallback.

**Access and troubleshooting:** Saving push settings requires **Projects → Edit** (`projects.edit`) and project membership for non-admins. **Customer API Logs** (`settings.customerApiLogs`) grants read-only push/activity access without granting editing. Pull-only access does not reveal a push editor. Users without inactive-project access cannot configure an inactive project. The **Delivery activity** panel is fixed to the current project and includes status filtering, attempts, errors and eligible administrator retries; the global **Settings → Customer API Logs** view remains available. Documentation itself remains administrator-only.

**Supported contract:** Push is fixed POST with MeterFlo's JSON payload, not a customizable field mapper. The 30-second timeout, five-attempt cycle and retry delays of 1, 5, 15 and 60 minutes are fixed behavior, not missing form controls. OAuth token acquisition/refresh, arbitrary methods and arbitrary additional headers are not supported. HTTP 2xx counts as success; a 200 response containing an application-level rejection is not interpreted automatically.

**Settings API:** `GET /api/projects/:projectId/customer-api` returns `{ settings, credentialStatus, canEdit }`, never credential values. `PUT` to the same route accepts exactly the six camelCase counterparts of the stored columns above and returns the same envelope. Field errors use HTTP 400 with `{ message, errors: { fieldName: ["explanation"] } }`. Legacy project create/update requests containing push fields are also validated; normal project-detail edits that omit them preserve saved push configuration.

### Authentication sent to the customer

| UI option / stored type | Request header and setup example |
| --- | --- |
| No authentication / `none` | No authorization header. Example: select this for a trusted test endpoint explicitly accepting unauthenticated POSTs; no secret field is needed. |
| API key header / `api_key` | `<configured header>: <secret value>`. Example: select API key header, enter `X-Customer-Key` and variable name `CUSTOMER_API_KEY`; configure the actual key separately in the server environment. A blank header uses `X-API-Key`. |
| Bearer token / `bearer_token` | `Authorization: Bearer <secret value>`. Example: select Bearer token and `CUSTOMER_API_TOKEN`; the server variable must contain the token alone, without the `Bearer ` prefix. |
| Basic authentication / `basic_auth` | `Authorization: Basic <base64 of username:password>`. Example: select Basic authentication and `CUSTOMER_API_BASIC`; set that variable separately to the customer's `username:password` credential pair. Do not enter that pair into the form or URL. |

For Basic authentication, the named environment variable must contain `username:password`. Supply server environment variables through your installation's secure environment configuration (for example, the service account or PM2 environment on an independent server, or workspace Secrets on Replit). Do not put credentials into source control.

**Missing credentials do not fall back to unauthenticated delivery.** The attempt fails before any HTTP request is sent, is logged, and enters the normal retry cycle. Invalid or missing URLs behave the same way.

Each attempt reads the project's **current URL and authentication settings**, so a configuration correction is used by the next retry. A payload already prepared for delivery is not rebuilt when these settings change.

## What triggers a delivery?

The trigger is centralized in project work-order storage, not separately implemented by each HTTP route. An enabled project's work-order update records an event when its status code or configured status label indicates **Completed**, **Trouble**, or **Unable to Complete**.

This covers:

- Dashboard work-order edits and the current system-changeout / reading-only wizard.
- Legacy and project-scoped mobile completion and system-changeout submissions.
- Mobile trouble reports and accepted offline synchronization uploads.
- Subsequent edits to already completed/trouble work orders.
- Time-tracking saves for an already finalized work order; these create a follow-up delivery with the updated timing.

The work-order update and delivery event are committed in the **same database transaction**. If the event cannot be recorded, the work-order database update rolls back instead of silently losing delivery. Time-tracking saves and their events are also transactional. File uploads and separate webhook integrations are not part of this database transaction.

Open/in-progress updates, work-order creation/imports, and rejected/conflicted synchronization uploads do not create delivery events. The dedicated reset operation does not send a customer update. Enabling a project does not automatically backfill older records or replay earlier failed logs.

## Delivery and automatic retry process

1. The server records a work-order snapshot in `customer_api_deliveries`.
2. A worker checks due deliveries every **5 seconds**. New events are initially delayed 5 seconds to let the normal completion flow finish.
3. On the first send, the worker prepares and saves the outbound JSON, adding the latest recorded time-tracking entry and, when enabled, the available work-order images. Once prepared, this JSON is reused unchanged for every retry.
4. MeterFlo POSTs JSON with a **30-second HTTP timeout**. Any **2xx** response is successful; no particular response-body structure is required.
5. Non-2xx responses, network/timeout errors, payload/file preparation errors, and configuration/authentication errors are logged and automatically retried.
6. One cycle permits **5 attempts total**: the initial attempt plus retries after **1 minute, 5 minutes, 15 minutes, and 1 hour**. These delays begin after the previous attempt finishes.
7. A valid `Retry-After` response header can extend a retry delay, up to 24 hours. It never shortens the normal delay.
8. After five unsuccessful attempts, the delivery remains **failed** until an administrator retries it.

Retries are persistent, not browser timers or an in-memory queue. They resume when the server restarts. An abandoned processing claim becomes eligible for recovery after **2 minutes**. The worker needs a running MeterFlo server and access to PostgreSQL.

Delivery does not wait for the customer's backend before returning from a work-order save. A customer rejection does **not** undo a successfully saved work order.

### Delivery states

| State | Meaning |
| --- | --- |
| `pending` | Waiting for the initial send or an administrator-requested retry. |
| `processing` | Claimed by a worker. |
| `retrying` | An unsuccessful attempt has a scheduled automatic retry. |
| `paused` | The project's integration is disabled; checked again after approximately one minute. No attempt is consumed while paused. |
| `delivered` | A 2xx response was recorded. No further automatic attempts. |
| `failed` | The current five-attempt cycle was exhausted. |

Active deliveries for the same project/work order are processed in creation order. A terminal failure does not permanently block later revisions.

### Duplicate and stale-update protection

Requests include:

```text
Content-Type: application/json
Idempotency-Key: <delivery UUID>
X-MeterFlo-Delivery-Id: <same delivery UUID>
```

The ID is stable across automatic and manual retries of the same delivery. Worker claims prevent overlapping attempts against one delivery.

HTTP delivery is **at least once**, not exactly once: a customer may accept a request just before the connection or MeterFlo process fails. The receiving system should persist the delivery ID and return a successful response for an already processed ID, without applying it twice.

Use `projectId` plus `workOrderId` as the internal work-order key; internal IDs are project-scoped. `customerWoId` is the customer's external identifier when available. Apply newer revisions using `updatedAt` and `deliveryCreatedAt`, and ignore older state updates if a historical delivery is manually replayed after a newer revision was accepted.

## JSON payload contract

New deliveries use **schemaVersion 2**. The original meter-named fields remain for compatibility and are aliases of the canonical system fields. Missing values are `null` unless noted. Database numeric readings are sent as **strings**, preserving precision.

| Fields | Meaning / source |
| --- | --- |
| `schemaVersion`, `deliveryId`, `deliveryCreatedAt` | Contract version (2), stable delivery UUID, and event creation timestamp. |
| `projectId`, `projectName`, `workOrderId` | MeterFlo project ID/name and project-scoped internal work-order ID. |
| `customerWoId` | Customer's external work-order identifier; empty string if absent. |
| `customerId`, `customerName`, `phone`, `email`, `route`, `zone` | Stored customer/contact and route information. |
| `status`, `serviceType`, `troubleCode`, `notes` | Saved work-order outcome and notes, including trouble information. |
| `oldSystemId`, `newSystemId`, `oldSystemReading`, `newSystemReading`, `oldSystemType`, `newSystemType` | Old/new system identifiers, readings, and types. |
| `oldMeterNumber`, `newMeterNumber`, `oldMeterReading`, `newMeterReading` | Compatibility aliases for the corresponding system identifiers/readings. |
| `meterType` | New system type, falling back to old system type. |
| `oldModuleId`, `newModuleId`, `oldModuleReading`, `newModuleReading`, `oldModuleType`, `newModuleType` | Module data. Readings correctly map from `old_module_read` / `new_module_read`. |
| `oldGps`, `newGps` | Both stored GPS strings. |
| `latitude`, `longitude` | Strings derived from `newGps`, falling back to `oldGps`; `null` when absent. |
| `gpsAccuracy` | Optional stored accuracy. The current canonical work-order table has no accuracy column, so this is normally `null`; no accuracy is fabricated. |
| `serviceAddress`, `serviceCity`, `serviceState`, `serviceZip` | Stored address components. |
| `createdBy`, `updatedBy`, `completedBy`, `scheduledBy` | Stored actor identifiers/names (not necessarily display names). |
| `assignedUserId`, `assignedGroupId` | Saved assignment. Completion can clear these, so they may be `null`; `completedBy` is separate. |
| `createdAt`, `updatedAt`, `scheduledAt`, `completedAt` | Stored timestamps as JSON dates, or `null`. |
| `attachments` | Stored attachment filenames/references, default `[]`. Non-image attachment contents, such as PDFs, are not embedded. |
| `signatureName` | Stored signer name even if image inclusion is off. |
| `timeTracking` | Latest saved entry as `{startTime, endTime, durationSeconds}`, or `null`. |
| `photos` | Only with image inclusion enabled: array of `{filename, type, contentType, data}` for every available image. Categorized types are `before`, `after`, `trouble`, `signature`; other/uncategorized images use type `photo`. `data` is base64 without a data-URL prefix. |
| `beforePhoto`, `afterPhoto` | Optional compatibility base64 fields for the first categorized image of each type. |
| `signature` | Optional base64 signature, from an image file or saved signature data. Omitted with image inclusion off. |

Core fields are frozen from the work-order save. Image bytes and timing are captured when the outbound payload is first prepared. A later time-tracking save produces another event rather than altering an already sent payload.

Historical deliveries replayed from earlier logs may have the **older contract**; their original outbound JSON is preserved when available. They still receive the new stable delivery headers.

### Receiving endpoint example

The receiving backend should:

1. Authenticate the configured header.
2. Validate required identifiers and parse JSON.
3. Check its persisted idempotency record for the incoming delivery ID.
4. Apply the work-order update and persist the delivery ID atomically.
5. Respond with a 2xx status only after durable acceptance.

Do not return a 2xx response for an update that was rejected or lost. Return an appropriate non-2xx status with a useful, non-sensitive response message when processing fails.

## Receiving and storing field images

**Audience:** the developer of the customer's receiving backend. Selecting **Customer API → Push delivery → Include field images** sends available image bytes **inside the same POST JSON body as the work-order update**. It does not initiate separate uploads, send multipart/form-data, split images into smaller requests, or provide MeterFlo download URLs. The customer must decode, store, and make those images available through its own authorized application.

### What MeterFlo sends

| Situation | Outbound behavior | Customer handling |
| --- | --- | --- |
| Include field images on | `photos` is an array of available recognized image files, potentially containing several images of the same category. | Process every entry, not only the first before/after image. |
| On, but no image files found | `photos: []`. A saved signature can still appear separately as `signature`. A missing work-order folder produces an empty array, not a delivery error. Other file-reading errors fail payload preparation and are retried. | Do not interpret an empty array as an instruction to delete previously stored images. Check for standalone `signature`. |
| Include field images off | `photos`, `beforePhoto`, `afterPhoto`, and `signature` are omitted. `attachments` and `signatureName` remain. | Apply the work-order data without requiring images; preserve existing customer-side images. Attachment references are not public download links. |
| Before/after/signature compatibility fields | `beforePhoto` and `afterPhoto` repeat the bytes of the first matching categorized photo; `signature` repeats the first signature photo when one exists. | Prefer `photos`. Do not save these aliases a second time when that category was already received. |
| Saved signature only | When no signature photo was found, the stored signature data is placed in `signature`, with any data-URL prefix removed. It is not automatically added to `photos`. This standalone field has **no filename or MIME-type field**. | Decode it independently and determine its format from the bytes. Keep `signatureName` as signer metadata, not as proof of cryptographic authenticity. |
| PDF or other non-image attachment | File bytes are not embedded. `attachments` can still contain stored filenames/references. | Do not assume every attachment has an accompanying `photos` entry, or try to fetch a filename as a URL. |

The server recursively reads the configured project's work-order folder. Recognized extensions, case-insensitively, are `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.tif`, and `.tiff`. Symlinks are not followed. `contentType` is inferred from the extension, **not from image decoding**; the receiver must verify the actual bytes.

`filename` can include relative category folders, such as `before/meter.png`. It is descriptive metadata, **never a safe filesystem path**. Exact lowercase folders `before`, `after`, `trouble`, and `signature` categorize their images; matching filename tokens also identify these categories (for example `after-meter.jpg`). Otherwise `type` is `photo`. These categories help organize the customer display; they do not alter the bytes. Folder categorization takes precedence over filename categorization.

**Timing:** work-order fields are captured at save time, but images are read when the worker first prepares the payload. The initial delay is five seconds; it is not an upload-completion guarantee. Images arriving after payload preparation are not inserted into that delivery. Automatic and manual retries resend the saved JSON unchanged. Turning image inclusion off later does not remove bytes from an already prepared delivery. This is neither a live image synchronization feed nor a backfill operation.

### Annotated image payload

This is a **schema-v2 excerpt**, not the complete work-order contract. The strings starting `BASE64_` are deliberately shortened explanatory placeholders and **are not valid base64 or runnable fixtures**. The executable tests below use a complete, valid one-pixel PNG.

```javascript
{
  "schemaVersion": 2,
  "deliveryId": "11111111-1111-4111-8111-111111111111",
  "projectId": 1,
  "workOrderId": 42,
  "customerWoId": "0002042",
  "updatedAt": "2026-10-11T20:00:00.000Z",
  "deliveryCreatedAt": "2026-10-11T20:00:01.000Z",
  "signatureName": "Demo signer",
  "photos": [
    {"filename":"before/meter.png","type":"before","contentType":"image/png","data":"BASE64_BEFORE_1"},
    {"filename":"before/connection.png","type":"before","contentType":"image/png","data":"BASE64_BEFORE_2"},
    {"filename":"after/meter.jpg","type":"after","contentType":"image/jpeg","data":"BASE64_AFTER"},
    {"filename":"trouble/access.png","type":"trouble","contentType":"image/png","data":"BASE64_TROUBLE"},
    {"filename":"signature/signature.png","type":"signature","contentType":"image/png","data":"BASE64_SIGNATURE"},
    {"filename":"site.webp","type":"photo","contentType":"image/webp","data":"BASE64_SITE"}
  ],
  "beforePhoto": "BASE64_BEFORE_1",
  "afterPhoto": "BASE64_AFTER",
  "signature": "BASE64_SIGNATURE"
}
```

Here there are **six distinct photo entries**, not nine images: the three compatibility fields repeat entries already in `photos`. For a saved-signature-only delivery, the relevant excerpt could instead be `{"photos":[],"signature":"BASE64_SIGNATURE","signatureName":"Demo signer"}`. Do not require `photos[].contentType` for that standalone field; identify its byte format.

### Customer receiving workflow

1. **Authenticate before parsing a large body.** Resolve the integration's identity from verified credentials, and authorize its project. Do not trust a body-supplied customer/project identifier as authorization.
2. **Validate the envelope.** Schema-v2 deliveries contain matching `deliveryId`, `Idempotency-Key`, and `X-MeterFlo-Delivery-Id`. Use the authenticated integration identity plus delivery ID as the idempotency key; scope work orders by integration, `projectId`, and `workOrderId`, and retain `customerWoId` for external matching.
3. **Handle duplicates and stale revisions.** Use a durable unique receipt record with a transaction/lock, not an in-memory set or an unprotected “check, then insert.” Return successful acceptance for an already committed delivery without storing its images again. Compare `updatedAt`, then `deliveryCreatedAt`, before replacing newer work-order state with a historical replay.
4. **Validate and decode all images.** Validate base64 strictly; `Buffer.from(data, "base64")` alone is permissive. Enforce encoded body, decoded image, aggregate byte, and image-count limits. Check the actual image format against the declared `contentType`; extension/MIME checks alone do not establish safety.
5. **Store bytes and metadata durably.** Use generated object/file IDs, storing the original filename only as metadata. Link category, verified content type, work-order keys, signer name and delivery ID. Store raw binary bytes, not a second base64 copy, unless your storage specifically requires it.
6. **Commit before acknowledging.** The example below stores image BLOBs, metadata, and the receipt in one SQLite transaction, so an error rolls them all back. With external object storage, stage uploads under unique private keys, commit references/receipt only after uploads succeed, and clean up uncommitted objects after errors/crashes. Never mark a receipt processed before its images are durable.
7. **Provide controlled retrieval.** The customer owns its download/display endpoints; enforce customer/project authorization on every read. Use generated IDs and verified content types, never a request-provided path or public bucket.

A reliable alternative is to authenticate/validate and **durably queue the complete payload, including bytes**, then return `202`. The customer is responsible for its own downstream retries, failure visibility and storage recovery: MeterFlo considers that `202` delivered and does not monitor the customer's queue.

### Runnable Node/Express receiver example

The reference implementation is also in `examples/customer-image-receiver.mjs`. It is **customer-side sample code**, not a new MeterFlo endpoint or a service started by MeterFlo. It uses Node.js with built-in `fetch` (use a supported LTS release), Express 4 and `better-sqlite3` 12; those packages are already installed in this repository. In a separate customer project, run `npm install express@4 better-sqlite3@12` and save the following as `customer-image-receiver.mjs`. The native SQLite package requires a compatible Node runtime and prebuilt binary or native build tools.

**Prerequisites and boundaries:**

- Supply a dedicated SQLite database on durable, private local disk, and verified **synchronous** `authenticate` and `authorizeProject` adapters. The example fails closed when the caller/project is unauthorized. Never use the demo keys in production.
- SQLite serializes concurrent writers using `BEGIN IMMEDIATE`; image BLOBs, work-order metadata and receipt commit together. A failed transaction leaves nothing partially accepted, so a retry can succeed after recovery. Multi-host deployments should use a shared transactional database or durable inbox with equivalent unique-key/locking semantics, not separate per-host SQLite files or a SQLite file on unsupported network storage.
- This sample checks actual byte signatures against declared MIME types. **It is not a full image decoder or production security gateway.** Add a maintained image decoder/scanner with dimension, pixel/decompression and processing-time limits before displaying untrusted images. The PNG fixture is a real complete image; passing a byte-signature check alone does not prove an arbitrary image is complete or safe.
- The default customer-side limits are **30 MiB JSON**, **8 MiB per decoded image**, **20 MiB decoded images total**, and **64 images**. They are demonstration receiver policies, not MeterFlo settings. Adjust them to the real contract, available memory and proxy limits.
- Only schema-v2, matching-header requests are accepted by this example. Historical legacy replay payloads may require a separately validated adapter; do not assume old contracts have these fields.

```javascript
// Customer-side reference only. MeterFlo does not import or run this module.
import express from "express";
import { randomUUID } from "node:crypto";

const categories = new Set(["before", "after", "trouble", "signature", "photo"]);
const problem = (status, message) => Object.assign(new Error(message), { status });

// Inspect bytes, not the filename. This identifies format, not complete image
// validity: a production decoder must also enforce dimensions and pixel limits.
export function imageFormat(bytes) {
  const hex = bytes.subarray(0, 8).toString("hex");
  if (hex === "89504e470d0a1a0a") return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString())) return "image/gif";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (hex.startsWith("424d")) return "image/bmp";
  if (hex.startsWith("49492a00") || hex.startsWith("4d4d002a")) return "image/tiff";
  throw problem(422, "Unsupported image byte format");
}

export function decodeImage(data, maxBytes) {
  if (typeof data !== "string" || !data.length || data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) {
    throw problem(422, "Invalid base64 image");
  }
  if (data.length > 4 * Math.ceil(maxBytes / 3)) throw problem(413, "Image exceeds decoded-size limit");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length > maxBytes) throw problem(413, "Image exceeds decoded-size limit");
  if (bytes.toString("base64") !== data) throw problem(422, "Noncanonical base64 image");
  return bytes;
}

export function collectImages(payload, { maxImageBytes, maxTotalBytes, maxImages }) {
  if (payload.photos !== undefined && !Array.isArray(payload.photos)) throw problem(422, "photos must be an array");
  const inputs = [...(payload.photos ?? [])];
  // These fields repeat the first matching photo; do not store them twice.
  for (const [key, type] of [["beforePhoto", "before"], ["afterPhoto", "after"], ["signature", "signature"]]) {
    if (payload[key] && !inputs.some(image => image?.type === type)) {
      inputs.push({ filename: `${type}-compatibility`, type, data: payload[key] });
    }
  }
  if (inputs.length > maxImages) throw problem(413, "Too many images");
  let total = 0;
  return inputs.map(image => {
    if (!image || !categories.has(image.type) || typeof image.filename !== "string" ||
        image.filename.length > 2000) throw problem(422, "Invalid image metadata");
    const bytes = decodeImage(image.data, maxImageBytes);
    total += bytes.length;
    if (total > maxTotalBytes) throw problem(413, "Images exceed total decoded-size limit");
    const contentType = imageFormat(bytes);
    if (image.contentType !== undefined && image.contentType !== contentType) {
      throw problem(422, "Image MIME type does not match bytes");
    }
    return { id: randomUUID(), filename: image.filename, type: image.type, contentType, bytes };
  });
}

/**
 * db: a dedicated better-sqlite3 Database on durable, private local storage.
 * authenticate(req): synchronous verified principal or null; never body-derived.
 * authorizeProject(principal, projectId): synchronous boolean.
 * This is a receiving customer service, NOT a route to install into MeterFlo.
 */
export function createImageReceiver({
  db, authenticate, authorizeProject, jsonLimit = "30mb",
  maxImageBytes = 8 * 1024 * 1024, maxTotalBytes = 20 * 1024 * 1024, maxImages = 64,
}) {
  if (typeof authenticate !== "function" || typeof authorizeProject !== "function") {
    throw new Error("Authentication and project authorization adapters are required");
  }
  for (const limit of [maxImageBytes, maxTotalBytes, maxImages]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Limits must be positive integers");
  }
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      sender TEXT NOT NULL, id TEXT NOT NULL, result TEXT NOT NULL,
      PRIMARY KEY(sender,id));
    CREATE TABLE IF NOT EXISTS work_orders (
      sender TEXT NOT NULL, project INTEGER NOT NULL, wo INTEGER NOT NULL,
      updated INTEGER NOT NULL, created INTEGER NOT NULL, metadata TEXT NOT NULL, refs TEXT NOT NULL,
      PRIMARY KEY(sender,project,wo));
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY, sender TEXT NOT NULL, project INTEGER NOT NULL, wo INTEGER NOT NULL,
      delivery TEXT NOT NULL, filename TEXT NOT NULL, category TEXT NOT NULL,
      mime TEXT NOT NULL, bytes BLOB NOT NULL);
  `);
  const save = db.transaction((sender, payload) => {
    const prior = db.prepare("SELECT result FROM receipts WHERE sender=? AND id=?").get(sender, payload.deliveryId);
    if (prior) return JSON.parse(prior.result);
    const old = db.prepare("SELECT * FROM work_orders WHERE sender=? AND project=? AND wo=?")
      .get(sender, payload.projectId, payload.workOrderId);
    const updated = Date.parse(payload.updatedAt), created = Date.parse(payload.deliveryCreatedAt);
    if (old && (updated < old.updated || (updated === old.updated && created <= old.created))) {
      const result = { deliveryId: payload.deliveryId, state: "ignored-stale", images: [] };
      db.prepare("INSERT INTO receipts VALUES (?,?,?)").run(sender, payload.deliveryId, JSON.stringify(result));
      return result;
    }
    const images = collectImages(payload, { maxImageBytes, maxTotalBytes, maxImages });
    const insert = db.prepare("INSERT INTO images VALUES (?,?,?,?,?,?,?,?,?)");
    for (const image of images) insert.run(image.id, sender, payload.projectId, payload.workOrderId,
      payload.deliveryId, image.filename, image.type, image.contentType, image.bytes);
    const refs = images.map(({ id, filename, type, contentType }) => ({
      id, filename, type, contentType, url: `/images/${id}`,
    }));
    // Absence/empty is not a deletion instruction. Retain earlier references.
    const currentRefs = refs.length ? refs : JSON.parse(old?.refs ?? "[]");
    const { photos, beforePhoto, afterPhoto, signature, ...metadata } = payload;
    db.prepare(`INSERT INTO work_orders VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(sender,project,wo) DO UPDATE SET updated=excluded.updated,
      created=excluded.created,metadata=excluded.metadata,refs=excluded.refs`)
      .run(sender, payload.projectId, payload.workOrderId, updated, created,
        JSON.stringify(metadata), JSON.stringify(currentRefs));
    const result = { deliveryId: payload.deliveryId, state: "accepted", images: refs };
    db.prepare("INSERT INTO receipts VALUES (?,?,?)").run(sender, payload.deliveryId, JSON.stringify(result));
    return result;
  });
  const app = express();
  app.disable("x-powered-by");
  // Authenticate BEFORE allocating memory to parse a potentially large body.
  app.use((req, res, next) => {
    try {
      const principal = authenticate(req);
      if (!principal || typeof principal.id !== "string" || !principal.id) return res.sendStatus(401);
      req.principal = principal;
      next();
    } catch { res.sendStatus(401); }
  });
  app.post("/work-orders", express.json({ limit: jsonLimit, inflate: false }), (req, res, next) => {
    try {
      const p = req.body;
      if (!p || p.schemaVersion !== 2 || typeof p.deliveryId !== "string" ||
          !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(p.deliveryId) ||
          !Number.isSafeInteger(p.projectId) || p.projectId < 1 ||
          !Number.isSafeInteger(p.workOrderId) || p.workOrderId < 1 ||
          typeof p.updatedAt !== "string" || !Number.isFinite(Date.parse(p.updatedAt)) ||
          typeof p.deliveryCreatedAt !== "string" || !Number.isFinite(Date.parse(p.deliveryCreatedAt))) {
        throw problem(422, "Invalid schema-v2 delivery identifiers or timestamps");
      }
      if (req.get("Idempotency-Key") !== p.deliveryId || req.get("X-MeterFlo-Delivery-Id") !== p.deliveryId) {
        throw problem(422, "Delivery headers and body must match");
      }
      if (authorizeProject(req.principal, p.projectId) !== true) throw problem(403, "Project not authorized");
      // BEGIN IMMEDIATE serializes competing SQLite writers; PK prevents duplicates.
      // Image BLOBs, references, work-order metadata and receipt commit together.
      res.status(200).json(save.immediate(req.principal.id, p));
    } catch (error) { next(error); }
  });
  app.get("/images/:id", (req, res, next) => {
    try {
      const image = db.prepare("SELECT * FROM images WHERE id=? AND sender=?")
        .get(req.params.id, req.principal.id);
      if (!image || authorizeProject(req.principal, image.project) !== true) return res.sendStatus(404);
      res.set({
        "Content-Type": image.mime, "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'",
        "Content-Disposition": `attachment; filename="${image.id}"`,
      }).send(image.bytes);
    } catch (error) { next(error); }
  });
  app.use((error, req, res, next) => {
    const status = error.status >= 400 && error.status < 500 ? error.status : 503;
    // Never log the payload, bytes, auth headers, DB paths or internal errors.
    res.status(status).json({ error: status === 503 ? "Storage unavailable; retry later" :
      error.type === "entity.too.large" ? "JSON body exceeds receiver limit" :
      error.type === "entity.parse.failed" ? "Invalid JSON" : error.message });
  });
  return app;
}
```

The example stores an update's image references in `work_orders.refs`; older image rows are retained as delivery history, not deleted automatically. Adopt an explicit customer retention policy before production. An empty/missing photo collection preserves the current references. A newer nonempty collection becomes the current collection; its images are independently linked to the new delivery. Only duplicate retries of the **same delivery** are deduplicated; this is not cross-revision content deduplication.

For a **local-only demonstration**, save this second file as `customer-image-receiver-demo.mjs` alongside the module. From this repository, run `node examples/customer-image-receiver-demo.mjs /tmp/customer-image-receiver-demo.sqlite`. No MeterFlo settings or customer endpoints need to be changed. The public dummy key is intentionally unsuitable for production:

The `/tmp` path is a disposable Linux example. On Windows, pass a database path in an existing private test directory, such as `node examples/customer-image-receiver-demo.mjs "C:\PrivateDemo\receiver.sqlite"`. For production, use persistent storage and an explicit backup/retention policy, not `/tmp`. Stop the local launcher with Ctrl+C and remove its disposable database files after testing.

```javascript
// LOCAL DEMONSTRATION ONLY. These public dummy keys provide no real security.
// Never deploy this launcher or configure a production MeterFlo project with it.
import Database from "better-sqlite3";
import { createImageReceiver } from "./customer-image-receiver.mjs";

const db = new Database(process.argv[2] || "/tmp/customer-image-receiver-demo.sqlite");
const app = createImageReceiver({
  db,
  authenticate: req => req.get("X-Demo-Key") === "local-demo-only" ? { id: "demo-customer" } : null,
  authorizeProject: (principal, projectId) => principal.id === "demo-customer" && projectId === 1,
});
const server = app.listen(5101, "127.0.0.1", () => {
  console.log("Local demo receiver on http://127.0.0.1:5101/work-orders; dummy projectId 1 only");
});
process.on("SIGINT", () => server.close(() => { db.close(); process.exit(0); }));
```

Send a complete PNG to that demo without involving MeterFlo, using Node's built-in `fetch`:

```javascript
// Save as send-demo.mjs and run: node send-demo.mjs
import { randomUUID } from "node:crypto";
const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const deliveryId = randomUUID();
const body = {
  schemaVersion: 2, deliveryId, projectId: 1, workOrderId: 42,
  customerWoId: "0002042", updatedAt: new Date().toISOString(),
  deliveryCreatedAt: new Date().toISOString(),
  photos: [{ filename: "before/demo.png", type: "before", contentType: "image/png", data }],
  beforePhoto: data,
};
const response = await fetch("http://127.0.0.1:5101/work-orders", {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Demo-Key": "local-demo-only",
    "Idempotency-Key": deliveryId, "X-MeterFlo-Delivery-Id": deliveryId },
  body: JSON.stringify(body),
});
const result = await response.json();
console.log(response.status, result);
if (!response.ok) throw new Error("Demo delivery rejected");
// Retry this SAME body with the SAME deliveryId: no second image is stored.
const image = await fetch(`http://127.0.0.1:5101${result.images[0].url}`, {
  headers: { "X-Demo-Key": "local-demo-only" },
});
if (!image.ok) throw new Error("Demo image retrieval rejected");
const bytes = Buffer.from(await image.arrayBuffer());
if (!bytes.equals(Buffer.from(data, "base64"))) throw new Error("Image bytes differ");
console.log("Decoded/retrieved PNG matches original bytes");
```

### Displaying images in the customer's application

The example's `/images/<generated-id>` URLs belong to the **customer receiver**, not MeterFlo. An `<img>` tag cannot attach a custom API-key header. Prefer a customer UI endpoint protected by its own user session and project permissions, or have the UI fetch through an authorized customer backend and create an object URL from the returned Blob. Revoke object URLs when no longer needed. **Never put the integration secret in browser JavaScript, a query string or an image URL.** The demo key is public only because the demo is local and disposable.

Serve verified image types with `X-Content-Type-Options: nosniff`, appropriate cache controls, and access checks. Keep the attachment disposition for downloads; for inline display, use a separately authorized, image-validated endpoint. Sanitize original filenames before rendering them as text, and do not treat embedded GPS/customer information or signatures as public data.

## Image request limits and troubleshooting

MeterFlo currently has **no outbound per-image/aggregate size setting, resizing, compression, thumbnail generation, multipart mode, or image-URL mode**. It loads recognized files, base64-encodes them, and prepares one full JSON payload in memory. Customer-side limits do not cause MeterFlo to automatically shrink or split the payload.

- Base64 length is `4 × ceil(binaryBytes / 3)`—approximately **33% larger** than the binary image. JSON metadata and repeated `beforePhoto`, `afterPhoto`, and `signature` fields add more. For example, 6 MiB before plus 6 MiB after is about 16 MiB in `photos`, **another 16 MiB in aliases**, plus metadata: it exceeds the example's 30 MiB body limit even though the distinct decoded images total only 12 MiB.
- Configure both the receiver's JSON parser **and every reverse proxy/gateway** for the maximum accepted body. Express's usual small default is inadequate for photos; the sample explicitly sets a configurable limit. Check infrastructure upload and read timeouts too.
- MeterFlo's request timeout is fixed at **30 seconds**. If synchronous validation/storage cannot reliably finish within that time, accept into a durable customer-side inbox/queue first. A timeout can occur after the customer commits: idempotency is therefore required.
- MeterFlo treats **all 2xx statuses as success**, including `202` and a `200` response whose JSON says `{"success":false}`. Return non-2xx for unaccepted work. Non-2xx responses **including 400, 401, 403, 413 and 422** are retried under the same five-attempt policy; they are not automatically classified as permanent errors.
- A helpful rejection can identify a limit/category or missing field without repeating image bytes, credentials, signer/customer details, stack traces or storage paths. The receiver's demo policies return `413` for size/count limits, `422` for invalid image/envelope data, and `503` for storage failures.

| Symptom | Likely cause and action |
| --- | --- |
| HTTP 413 / “request entity too large” | A customer parser/proxy limit was exceeded. Measure the full serialized body, including aliases; adjust approved limits and capacity, then admin retry the same delivery. Turning images off does not rebuild a prepared oversized payload. |
| HTTP 422 / image MIME mismatch | MeterFlo derives MIME from file extension; content may not match. Inspect the affected file safely and the receiver's supported formats. Do not bypass validation or rename malicious content to make it pass. Existing prepared deliveries retain their original bytes; fixing a source file alone does not rewrite them. |
| Accepted work order but no images | Check whether inclusion was off at preparation, `photos` is empty, files have recognized extensions, or uploads arrived after preparation. Look for standalone `signature`. A filename in `attachments` alone does not carry bytes. |
| Duplicate photos after retry | The receiver lacks a durable, concurrency-safe delivery receipt or also stored compatibility aliases as extra images. Deduplicate by authenticated integration and stable delivery ID, not by work-order ID alone. |
| Timeout / 503 / partial customer storage | Do not acknowledge lost work. Roll back or clean up partial storage, resolve the customer's capacity/storage issue, and retry the same delivery. A previously committed receipt must return success without writing twice. |

Use **Customer API → Push delivery → delivery activity → View attempts**, or **Settings → Customer API Logs**, to inspect delivery IDs, HTTP status and response/error history. Base64 bodies can contain private customer photos and signatures; protect database/backups, do not copy them into support messages or ordinary request logs, and use sanitized samples for troubleshooting. Base64 is not encryption: require HTTPS outside a controlled local test network, restrict storage access, and define customer retention/deletion rules explicitly.

### Verify the receiver examples

Run from the repository root:

```bash
node --import tsx --test tests/customer-image-receiver.test.mjs
npm run test:api-import-docs
npm run test:customer-api
```

The receiver suite uses disposable SQLite databases, local HTTP servers and complete dummy PNGs, with no customer endpoint, real credentials or production work-order changes. It checks byte-for-byte decoding/retrieval, categories and multiple images, alias handling, off/empty/signature fallback, concurrent retries and durable receipts, stale updates, invalid data/MIME, image/body limits, and rollback/recovery after a storage failure. It also checks that this embedded receiver source matches the runnable module. These checks validate the example, **not a customer's deployment**; review its real storage, authentication, full image decoding/scanning, resource limits and monitoring before going live.

## Administrator workflow and troubleshooting

Open **Settings → Customer API Logs**.

### Delivery queue

- Filter by project or state and page through deliveries.
- See lifetime attempt count, last HTTP status/error, and the next scheduled check.
- Open **View attempts** for the selected delivery's chronological attempt numbers, request URL, error, response, and outbound payload.
- Data refreshes every 5 seconds. Image bytes are summarized in the delivery dialog to keep it readable.
- An administrator can select **Retry delivery** for `failed`, `retrying`, or `paused` deliveries after enabling the project's integration. This queues an immediate retry and begins a fresh five-attempt cycle. The original payload and delivery ID remain unchanged.
- Queued, processing, and delivered requests cannot be manually retried; repeated clicks do not create parallel sends.

### Earlier attempt history

The existing attempt history remains available, including logs from the old implementation. It supports project and success/failure filters and expandable payload/response details.

For a failed older log without a delivery ID, an administrator can choose **Retry legacy delivery**. MeterFlo creates a persistent delivery from the saved outbound JSON (or maps a logged raw work-order record into the current contract), links the original attempt, and begins a new retry cycle. A missing/invalid payload or disabled integration produces a visible error instead of pretending to replay it. Older successes are not replayed.

### Common failures

| Symptom | Action |
| --- | --- |
| No delivery event | Confirm integration was enabled at save time and the work order was finalized. Creation/import and reset are not triggers. |
| Pending/retrying never progresses | Confirm the MeterFlo server and database are running; check the server's queue-worker errors. |
| Paused | Re-enable the project's Customer API. Wait for the next check or use admin retry. |
| Authentication secret not configured | Set the named secret on the running server and restart the process, then retry. |
| HTTP 401/403 | Check auth type, variable name, value, and header expected by the customer. |
| HTTP 400/422 | Inspect the request and response. Confirm the receiver supports the documented types/null values and compatibility fields. |
| HTTP 404 | Correct the endpoint path; MeterFlo does not append a route to the configured URL. |
| HTTP 429/503 | Check customer availability/rate limits; automatic retries honor `Retry-After`. |
| No HTTP response / timeout | Check DNS, TLS, firewall/routing, endpoint availability, and the 30-second timeout. |
| Redirect error | Configure the final receiving URL directly. |
| File preparation error | Check the configured project file root, folder permissions, and existing image files. |
| Failed after five attempts | Correct the cause, then use Retry delivery. |

## Administration API

These routes use MeterFlo's authenticated local session cookie, not customer-backend credentials.

| Route | Access and response |
| --- | --- |
| `GET /api/customer-api-deliveries` | Requires `settings.customerApiLogs`. Optional `projectId`, `status`, `limit` (1–500, default 50), `offset` (default 0). Returns `{deliveries, total, limit, offset}`; no image payloads in summaries. |
| `GET /api/customer-api-deliveries/:deliveryId/attempts` | Same log permission; returns the attempts for that delivery, including saved request/response/error details. |
| `POST /api/customer-api-deliveries/:deliveryId/retry` | Admin only. Returns 202 when queued, 404 if missing, 409 if integration is disabled or the state cannot be retried. |
| `POST /api/customer-api-logs/:logId/retry` | Admin only. Returns 202 for an eligible historical failure with saved JSON; 409 for an ineligible replay. |
| `GET /api/customer-api-logs` | Same log permission. Existing `projectId`, `success=true/false`, `limit` filters; limit defaults to 100 and is capped at 500. |

Non-admin log viewers see only projects assigned to them; filtering is applied before limiting results. Permission to view logs does **not** grant manual retry rights.

New attempt records include `deliveryId`, `attemptNumber` (lifetime one-based number), `triggeredBy` (`automatic` or `manual:<admin ID>`), `retryCount` (attempt number minus one), URL, payload, HTTP response, success/error, and timestamp. A replayed historical attempt is labeled `legacy`.

Authentication headers are not saved. URL credentials/query values and known configured credential values in new response/error logs are redacted. Response bodies are limited to **64 KiB**. Work-order payloads can contain customer information and base64 images, so restrict log access and protect database backups. Existing historical logs are retained as they were originally recorded.

## Installation and implementation

At startup MeterFlo applies an additive, idempotent schema update: it creates `customer_api_deliveries` and adds delivery/attempt fields to existing `customer_api_logs`. The server's database account needs the required table/column creation permissions for this update. No database replacement or destructive migration is required.

The queue and attempt logs are included in MeterFlo PostgreSQL backups. Pending events remain in PostgreSQL through application restarts.

Implementation:

- `server/customerApiService.ts`: transactional enqueue helper, worker claims/sends, persisted retries, and manual replay.
- `server/customerApiPayload.ts`: payload mapping, image collection, auth headers, and retry delays.
- `server/customerApiSchema.ts` and `shared/schema.ts`: additive database schema.
- `server/projectDb.ts`: transactional work-order update trigger.
- `server/storage.ts`: transactional timing trigger and scoped log queries.
- `server/routes.ts`: authenticated administration routes.
- `client/src/components/customer-api-deliveries.tsx` and `client/src/pages/settings.tsx`: delivery queue and troubleshooting UI.

Run the targeted regression suite with `npm run test:customer-api`. It uses a temporary test project and local HTTP receiver, then removes its fixtures; it does not send data to a real customer endpoint.

Run `npx tsx --test tests/customer-api-settings.test.ts` for push validation/field coverage. Run `npm run build` first; with the dev app running and Playwright/Chromium available, `node --import tsx tests/customer-api-hub.cjs` verifies all four saved authentication selections, mock HTTP delivery, image inclusion, retries, normal role-management permissions, signed-in navigation and phone layout. Set `PLAYWRIGHT_MODULE_PATH` and `CHROMIUM_PATH` if the browser tooling is outside normal package resolution. The harness serves the built frontend with normal session authentication, uses test-process-only dummy credentials and cleans up its disposable projects, roles, users, sessions and images; no real customer URL or credentials are required.

Run the field-reference checks with `npm run test:api-import-docs`. They verify form/option coverage, all mapping-target limits and update checkboxes, the four complete configuration objects, mock response paths, authentication headers, pagination termination, and incremental query examples. They use the shared validators/fetch helpers without network calls, database writes, or real credentials. The optional `tests/documentation-ui.cjs` harness verifies normal signed-in guide navigation and narrow-screen rendering using an available Playwright/Chromium runtime and a disposable administrator; it creates no projects or work orders and cleans up its account/session afterward.
