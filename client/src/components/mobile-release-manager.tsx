import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MobileRelease, MobileReleaseList } from "@shared/mobile-releases";
import { APK_MAX_SIZE } from "@shared/mobile-releases";
import { uploadFileWithChunking, type ChunkedUploadProgress } from "@/lib/chunkedUpload";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertCircle, Check, Download, HardDrive, PackagePlus, RefreshCw, Send, Trash2 } from "lucide-react";

const releaseListKey = ["/api/mobile-releases"];
const latestReleaseKey = ["/api/mobile-releases/latest"];
const API = "/api/mobile-releases";

type ReleaseListWithCleanup = MobileReleaseList;

interface ApiError extends Error {
  status?: number;
}

async function responseError(response: Response, fallback: string): Promise<ApiError> {
  let message = fallback;
  try {
    const body = await response.json();
    if (typeof body?.message === "string") message = body.message;
  } catch {
    // The response may not contain JSON, for example for a HEAD request.
  }
  const error = new Error(message) as ApiError;
  error.status = response.status;
  return error;
}

async function downloadRelease(release: MobileRelease, onGone?: () => void) {
  const url = `${API}/${encodeURIComponent(release.id)}/download`;
  const response = await fetch(url, { method: "HEAD", credentials: "include" });
  if (!response.ok) {
    if (response.status === 404 || response.status === 410) onGone?.();
    throw await responseError(response, response.status === 404 ? "This APK is no longer available." : "Could not prepare the APK download.");
  }
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", release.fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(value: string | null): string {
  if (!value) return "Not published";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  const typed = error as ApiError;
  const status = typed?.status ?? Number(typed?.message?.match(/^(\d{3}):/)?.[1]);
  const message = status === 401
    ? "Your session has expired. Sign in again to access APK releases."
    : status === 403
      ? "Your account does not have permission for this APK release action."
      : typed?.message || "The release service could not be reached.";
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2 text-sm text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>{message}</span>
      </div>
      {retry && <Button type="button" variant="outline" size="sm" onClick={retry}>Retry</Button>}
    </div>
  );
}

export function MobileReleaseManager() {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const [buildCode, setBuildCode] = useState("");
  const [notes, setNotes] = useState("");
  const [progress, setProgress] = useState<ChunkedUploadProgress | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<MobileRelease | null>(null);
  const [notice, setNotice] = useState("");
  const refreshReleaseQueries = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: releaseListKey }),
    queryClient.invalidateQueries({ queryKey: latestReleaseKey }),
  ]);
  const releasesQuery = useQuery<ReleaseListWithCleanup>({
    queryKey: releaseListKey,
    queryFn: async () => {
      const response = await fetch(API, { credentials: "include" });
      if (!response.ok) throw await responseError(response, "Could not load APK releases.");
      return response.json();
    },
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const releaseData = releasesQuery.data;

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose an APK file first.");
      const response = await uploadFileWithChunking({
        file,
        url: `${API}/uploads/finalize`,
        forceChunking: true,
        chunkBaseUrl: `${API}/uploads`,
        metadata: {
          version: version.trim(),
          buildCode: buildCode.trim() ? Number(buildCode) : null,
          notes: notes.trim(),
        },
        onProgress: setProgress,
      });
      if (!response.ok) throw await responseError(response, "APK upload failed.");
      return response.json() as Promise<MobileRelease>;
    },
    onSuccess: async (release) => {
      setNotice(`Version ${release.version} uploaded. Publish it when it is ready for technicians.`);
      setUploadError("");
      setFile(null);
      setVersion("");
      setBuildCode("");
      setNotes("");
      if (fileInput.current) fileInput.current.value = "";
      setProgress(null);
      await refreshReleaseQueries();
    },
    onError: (error) => setUploadError(error instanceof Error ? error.message : "APK upload failed. Retry when ready."),
  });

  const publishMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("POST", `${API}/${encodeURIComponent(id)}/publish`);
      return response.json() as Promise<MobileRelease>;
    },
    onSuccess: async (release) => {
      setNotice(`Version ${release.version} is now the latest release.`);
      await refreshReleaseQueries();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (release: MobileRelease) => {
      const isLatest = releaseData?.latestId === release.id;
      const response = await apiRequest("DELETE", `${API}/${encodeURIComponent(release.id)}`, isLatest ? { withdrawLatest: true } : {});
      return response.json() as Promise<{ message: string; pendingCleanup: number }>;
    },
    onSuccess: async (result) => {
      setNotice(result.message || "Release removed.");
      setDeleteTarget(null);
      await refreshReleaseQueries();
      await queryClient.invalidateQueries({ queryKey: releaseListKey });
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `${API}/cleanup`);
      return response.json() as Promise<{ pendingCleanup: number }>;
    },
    onSuccess: async (result) => {
      setNotice(result.pendingCleanup > 0
        ? `Storage cleanup ran. ${result.pendingCleanup} cleanup job${result.pendingCleanup === 1 ? "" : "s"} still pending.`
        : "Storage cleanup complete. No APK cleanup jobs are pending.");
      await refreshReleaseQueries();
    },
  });

  const busy = uploadMutation.isPending || publishMutation.isPending || deleteMutation.isPending || cleanupMutation.isPending;
  const latestId = releaseData?.latestId;
  const pendingCleanup = releaseData?.pendingCleanup ?? 0;
  const validFile = !!file && file.name.toLowerCase().endsWith(".apk") && file.size > 0 && file.size <= APK_MAX_SIZE;
  const validVersion = version.trim().length > 0 && version.trim().length <= 64;
  const validBuildCode = !buildCode.trim() || (/^[1-9]\d*$/.test(buildCode) && Number(buildCode) <= 2_100_000_000);

  async function handleDownload(release: MobileRelease) {
    setDownloadError("");
    try {
      await downloadRelease(release, () => { void refreshReleaseQueries(); });
    } catch (error) {
      const status = (error as ApiError)?.status;
      setDownloadError(status ? `${status}: ${(error as Error).message}` : error instanceof Error ? error.message : "Could not download this APK.");
    }
  }

  function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setUploadError("");
    if (!validFile || !validVersion || !validBuildCode) return;
    uploadMutation.mutate();
  }

  return (
    <Card className="mt-6 overflow-hidden" data-testid="card-android-apk-releases">
      <CardHeader className="border-b bg-muted/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-primary" />
              <CardTitle>Android APK Releases</CardTitle>
            </div>
            <CardDescription className="mt-2 max-w-2xl">
              Upload a trusted build first, then publish it separately when technicians should receive it.
              Version and build code are entered by an administrator; they are not read from the APK.
            </CardDescription>
             <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
               Windows/Linux installations store APKs in a protected local directory, without a Replit account or bucket.
               Replit-hosted installations use private App Storage instead.
             </p>
          </div>
          {releaseData?.storage && (
            <Badge variant={releaseData.storage.available ? "secondary" : "destructive"}>
              {releaseData.storage.available ? releaseData.storage.provider === "local" ? "Local file storage" : "Replit App Storage" : "Storage unavailable"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {releasesQuery.isLoading ? (
          <div className="space-y-3" aria-label="Loading Android releases">
            <div className="h-16 animate-pulse rounded-md bg-muted" />
            <div className="h-28 animate-pulse rounded-md bg-muted" />
          </div>
        ) : releasesQuery.isError ? (
          <ErrorNotice error={releasesQuery.error} retry={() => void releasesQuery.refetch()} />
        ) : (
          <>
            {releaseData?.storage && !releaseData.storage.available && (
              <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
                <p className="font-medium">APK storage is unavailable</p>
                <p className="mt-1 text-muted-foreground">{releaseData.storage.message || "Uploads are currently disabled."}</p>
              </div>
            )}
            {pendingCleanup > 0 && (
              <div role="status" className="flex flex-col gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm">
                   <p className="font-medium">{pendingCleanup} APK cleanup {pendingCleanup === 1 ? "job is" : "jobs are"} pending</p>
                   <p className="mt-1 text-muted-foreground">Removed releases or expired uploads may still have bytes pending deletion.</p>
                </div>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => cleanupMutation.mutate()}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${cleanupMutation.isPending ? "animate-spin" : ""}`} />
                  Retry storage cleanup
                </Button>
              </div>
            )}
            {cleanupMutation.isError && <ErrorNotice error={cleanupMutation.error} />}
            {(publishMutation.isError || deleteMutation.isError) && (
              <ErrorNotice error={publishMutation.error || deleteMutation.error} />
            )}
            {notice && <div role="status" className="rounded-md border border-primary/20 bg-primary/5 px-4 py-3 text-sm">{notice}</div>}
            {downloadError && <ErrorNotice error={new Error(downloadError)} />}

            <form onSubmit={handleUpload} className="space-y-4 rounded-lg border p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <PackagePlus className="h-4 w-4 text-primary" />
                <h3 className="font-semibold">Upload an Android build</h3>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="apk-file">APK file</Label>
                  <Input
                    ref={fileInput}
                    id="apk-file"
                    type="file"
                    accept=".apk,application/vnd.android.package-archive"
                    disabled={busy || !releaseData?.storage.available}
                    onChange={(event) => {
                      const selected = event.target.files?.[0] || null;
                      setFile(selected);
                      setUploadError("");
                    }}
                    data-testid="input-apk-file"
                  />
                  <p className="text-xs text-muted-foreground">Example: MeterFlo-2.8.1.apk · Maximum {releaseData?.storage.maxSizeMB ?? 512} MB; uploaded in 5 MB chunks.</p>
                  {file && (file.size > APK_MAX_SIZE || !file.name.toLowerCase().endsWith(".apk")) && (
                    <p className="text-xs text-destructive">Choose an APK file no larger than 512 MB.</p>
                  )}
                  {file && validFile && <p className="text-xs text-muted-foreground">{file.name} · {formatBytes(file.size)}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apk-version">Version *</Label>
                  <Input id="apk-version" maxLength={64} placeholder="Example: 2.8.1" value={version} onChange={(event) => setVersion(event.target.value)} disabled={busy} required />
                   <p className="text-xs text-muted-foreground">Enter the version shown to Dashboard users, up to 64 characters.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="apk-build-code">Build code (optional)</Label>
                  <Input id="apk-build-code" inputMode="numeric" placeholder="Example: 20801" value={buildCode} onChange={(event) => setBuildCode(event.target.value)} disabled={busy} />
                  <p className="text-xs text-muted-foreground">Positive whole number up to 2,100,000,000. This value is not extracted from the APK.</p>
                  {!validBuildCode && <p className="text-xs text-destructive">Enter a valid positive whole number.</p>}
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="apk-notes">Release notes (optional)</Label>
                  <Textarea id="apk-notes" maxLength={5000} placeholder="Example: Fixes intermittent work-order sync in low-connectivity areas." value={notes} onChange={(event) => setNotes(event.target.value)} disabled={busy} rows={3} />
                   <p className="text-xs text-muted-foreground">{notes.length}/5000 characters · Shared with all Dashboard users alongside this release.</p>
                </div>
              </div>
              {progress && (
                <div className="space-y-2" role="status" aria-live="polite">
                  <div className="flex justify-between gap-3 text-sm"><span>{progress.message}</span><span>{progress.percent}%</span></div>
                  <Progress value={progress.percent} className="h-2" />
                </div>
              )}
              {uploadError && <ErrorNotice error={new Error(uploadError)} retry={() => uploadMutation.mutate()} />}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="submit" disabled={busy || !validFile || !validVersion || !validBuildCode || !releaseData?.storage.available} data-testid="button-upload-apk">
                  <PackagePlus className="mr-2 h-4 w-4" />
                  {uploadMutation.isPending ? "Uploading APK…" : "Upload release"}
                </Button>
              </div>
            </form>

            <section className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h3 className="font-semibold">Release history</h3>
                  <p className="text-sm text-muted-foreground">Publishing makes a build the current technician download. No previous build is promoted automatically.</p>
                </div>
                <Button type="button" variant="ghost" size="sm" disabled={releasesQuery.isFetching} onClick={() => void releasesQuery.refetch()}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${releasesQuery.isFetching ? "animate-spin" : ""}`} /> Refresh
                </Button>
              </div>
              {releaseData?.releases.length ? (
                <div className="divide-y rounded-lg border">
                  {releaseData.releases.map((release) => {
                    const isLatest = release.id === latestId;
                    return (
                      <article key={release.id} className="flex flex-col gap-4 p-4 lg:flex-row lg:items-start lg:justify-between" data-testid={`mobile-release-${release.id}`}>
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                             <h4 className="break-all font-semibold">Version {release.version}</h4>
                            {isLatest ? <Badge><Check className="mr-1 h-3 w-3" />Latest</Badge> : release.publishedAt ? <Badge variant="secondary">Published previously</Badge> : <Badge variant="outline">Uploaded · unpublished</Badge>}
                            {release.buildCode != null && <span className="text-xs text-muted-foreground">Build {release.buildCode}</span>}
                          </div>
                          <p className="break-all text-sm text-muted-foreground">{release.fileName} · {formatBytes(release.size)}</p>
                           {release.notes && <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{release.notes}</p>}
                          <p className="text-xs text-muted-foreground">Uploaded {formatDate(release.uploadedAt)}{release.publishedAt ? ` · Published ${formatDate(release.publishedAt)}` : ""}</p>
                        </div>
                        <div className="flex shrink-0 flex-wrap gap-2">
                          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void handleDownload(release)}>
                            <Download className="mr-2 h-4 w-4" /> Download
                          </Button>
                          {!isLatest && (
                            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => publishMutation.mutate(release.id)}>
                              <Send className="mr-2 h-4 w-4" /> Set as latest
                            </Button>
                          )}
                          <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={busy} onClick={() => setDeleteTarget(release)}>
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-7 text-center">
                  <PackagePlus className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
                  <p className="font-medium">No APK releases yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">Upload a signed Android build to start a trusted release history.</p>
                </div>
              )}
            </section>
          </>
        )}
      </CardContent>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleteMutation.isPending) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{deleteTarget?.id === latestId ? "Withdraw and delete this release?" : "Delete this release?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.id === latestId
                ? "This is the current latest release. It will be withdrawn and technicians will have no downloadable release until an administrator explicitly publishes another build. There is no automatic fallback."
                : "This removes the selected APK release from the managed history."}
              {" "}Storage cleanup may remain pending after the record is removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deleteMutation.isPending} onClick={(event) => {
              event.preventDefault();
              if (deleteTarget) deleteMutation.mutate(deleteTarget);
            }}>
              {deleteMutation.isPending ? "Deleting…" : deleteTarget?.id === latestId ? "Withdraw and delete" : "Delete release"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function DashboardMobileRelease() {
  const queryClient = useQueryClient();
  const [downloadError, setDownloadError] = useState("");
  const query = useQuery<{ release: MobileRelease | null }>({
    queryKey: latestReleaseKey,
    queryFn: async () => {
      const response = await fetch(`${API}/latest`, { credentials: "include" });
      if (!response.ok) throw await responseError(response, "Could not load the latest Android release.");
      return response.json();
    },
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const release = query.data?.release;

  async function downloadLatest() {
    if (!release) return;
    setDownloadError("");
    try {
      await downloadRelease(release, () => {
        void queryClient.invalidateQueries({ queryKey: latestReleaseKey });
      });
    } catch (error) {
      const status = (error as ApiError)?.status;
      setDownloadError(status ? `${status}: ${(error as Error).message}` : error instanceof Error ? error.message : "Could not download the latest APK.");
    }
  }

  return (
    <Card className="mb-6 overflow-hidden border-primary/20" data-testid="card-latest-android-release">
      <CardHeader className="border-b bg-primary/[0.035] pb-4">
        <div className="flex items-center gap-2">
          <HardDrive className="h-5 w-5 text-primary" />
          <div>
            <CardTitle className="text-lg">MeterFlo for Android</CardTitle>
            <CardDescription>Trusted builds published by your MeterFlo administrator</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {query.isLoading ? (
          <div className="space-y-2" aria-label="Loading latest Android release">
            <div className="h-5 w-40 animate-pulse rounded bg-muted" />
            <div className="h-4 w-64 max-w-full animate-pulse rounded bg-muted" />
          </div>
        ) : query.isError ? (
          <ErrorNotice error={query.error} retry={() => void query.refetch()} />
        ) : !release ? (
          <div className="rounded-md border border-dashed p-4">
            <p className="font-medium">No Android release is currently published</p>
            <p className="mt-1 text-sm text-muted-foreground">Your administrator will make an APK available here when it is ready.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="break-all text-lg font-semibold">Version {release.version}</p>
                <Badge variant="secondary">Latest</Badge>
                {release.buildCode != null && <span className="text-xs text-muted-foreground">Build {release.buildCode}</span>}
              </div>
              <p className="mt-1 break-all text-sm text-muted-foreground">{release.fileName} · {formatBytes(release.size)}</p>
              {release.notes && <p className="mt-2 whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{release.notes}</p>}
              <p className="mt-2 text-xs text-muted-foreground">Published {formatDate(release.publishedAt)}</p>
            </div>
            <Button type="button" className="shrink-0" onClick={() => void downloadLatest()} data-testid="button-download-latest-apk">
              <Download className="mr-2 h-4 w-4" /> Download APK
            </Button>
          </div>
        )}
        {downloadError && <div className="mt-4"><ErrorNotice error={new Error(downloadError)} /></div>}
      </CardContent>
    </Card>
  );
}
