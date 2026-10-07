import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "./Toast.js";
import { useReports, type SharedReport } from "./ReportsContext.js";
import { ReportDetails } from "./ReportDetails.js";

type SelectedFile = {
  id: string;
  file: File;
  preview?: string;
  progress: number;
  state: "ready" | "uploading" | "complete";
};
const kind = (file: File) =>
  file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("audio/")
        ? "audio"
        : file.type === "application/pdf"
          ? "pdf"
          : "powerpoint";
const upload = (
  url: string,
  file: File,
  token: string,
  onProgress: (value: number) => void,
) =>
  new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) =>
      e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();
      try {
        reject(new Error(JSON.parse(xhr.responseText).error));
      } catch {
        reject(new Error(`Cloudflare upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload connection was interrupted"));
    xhr.send(file);
  });

export function DashboardApp() {
  const [path, setPath] = useState(location.pathname);
  const go = (path: string) => {
    history.pushState({}, "", path);
    setPath(path);
  };
  useEffect(() => {
    const listener = () => setPath(location.pathname);
    addEventListener("popstate", listener);
    return () => removeEventListener("popstate", listener);
  }, []);
  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>MFM NCR12 Reports</h1>
        <nav className="nav-actions">
          <button onClick={() => go("/")}>Submit</button>
          <button onClick={() => go("/reports")}>Browse reports</button>
        </nav>
      </header>
      {path === "/reports" ? (
        <ReportsDashboard />
      ) : (
        <UploadForm onComplete={() => go("/reports")} />
      )}
    </main>
  );
}

function UploadForm({ onComplete }: { onComplete: () => void }) {
  const { notify } = useToast();
  const { refresh } = useReports();
  const [form, setForm] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const choose = (input: File[]) =>
    setFiles((current) => [
      ...current,
      ...input.map((file) => ({
        id: crypto.randomUUID(),
        file,
        preview:
          file.type.startsWith("image/") || file.type.startsWith("video/")
            ? URL.createObjectURL(file)
            : undefined,
        progress: 0,
        state: "ready" as const,
      })),
    ]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const draftResponse = await fetch("/api/drafts", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({ ...form, acknowledgement: ack }),
      });
      const draft = await draftResponse.json();
      if (!draftResponse.ok) throw new Error(draft.error);
      for (const item of files) {
        const reservedResponse = await fetch(`/api/drafts/${draft.id}/files`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${draft.token}`,
          },
          body: JSON.stringify({
            originalName: item.file.name,
            contentType: item.file.type || "application/octet-stream",
            bytes: item.file.size,
            category: kind(item.file),
          }),
        });
        const reserved = await reservedResponse.json();
        if (!reservedResponse.ok) throw new Error(reserved.error);
        setFiles((current) =>
          current.map((value) =>
            value.id === item.id ? { ...value, state: "uploading" } : value,
          ),
        );
        await upload(reserved.upload.url, item.file, draft.token, (progress) =>
          setFiles((current) =>
            current.map((value) =>
              value.id === item.id ? { ...value, progress } : value,
            ),
          ),
        );
        const completed = await fetch(
          `/api/drafts/${draft.id}/files/${reserved.id}/complete`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${draft.token}` },
          },
        );
        if (!completed.ok) throw new Error((await completed.json()).error);
        setFiles((current) =>
          current.map((value) =>
            value.id === item.id
              ? { ...value, state: "complete", progress: 100 }
              : value,
          ),
        );
      }
      const published = await fetch(`/api/drafts/${draft.id}/publish`, {
        method: "POST",
        headers: { authorization: `Bearer ${draft.token}` },
      });
      if (!published.ok) throw new Error((await published.json()).error);
      await refresh();
      notify("Report published successfully", "success");
      files.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
      setForm({});
      setFiles([]);
      setAck(false);
      onComplete();
    } catch (error) {
      notify(error instanceof Error ? error.message : "Upload failed", "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="workspace">
      <form className="upload-form" onSubmit={submit}>
        <h2>Submit a report</h2>
        <div className="form-grid">
          {[
            ["organisation", "Organisation"],
            ["uploader", "Uploader name"],
            ["title", "Report title"],
            ["periodStart", "Period start"],
            ["periodEnd", "Period end"],
          ].map(([key, label]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                required
                type={key.startsWith("period") ? "date" : "text"}
                value={form[key] || ""}
                onChange={(event) => set(key, event.target.value)}
              />
            </label>
          ))}
          <label className="field full">
            <span>Description</span>
            <textarea
              rows={4}
              value={form.description || ""}
              onChange={(event) => set("description", event.target.value)}
            />
          </label>
        </div>
        <label className="dropzone" htmlFor="files">
          <strong>Select files</strong>
          <span>Preview and upload progress will appear below.</span>
          <input
            id="files"
            type="file"
            multiple
            hidden
            onChange={(event) => choose(Array.from(event.target.files || []))}
          />
        </label>
        <div className="upload-list">
          {files.map((item) => (
            <article className="upload-item" key={item.id}>
              {item.preview && <img src={item.preview} alt="" />}
              <div>
                <strong>{item.file.name}</strong>
                <span>
                  {item.state === "ready"
                    ? "Ready"
                    : item.state === "complete"
                      ? "Uploaded"
                      : `Uploading ${item.progress}%`}
                </span>
                <progress max="100" value={item.progress} />
              </div>
            </article>
          ))}
        </div>
        <label className="acknowledgement">
          <input
            required
            type="checkbox"
            checked={ack}
            onChange={(event) => setAck(event.target.checked)}
          />
          <span>I acknowledge public visibility.</span>
        </label>
        <div className="action-bar">
          <button disabled={busy || !files.length || !ack}>
            {busy ? "Uploading…" : "Submit report"}
          </button>
        </div>
      </form>
    </section>
  );
}

function ReportsDashboard() {
  const { reports, refresh } = useReports();
  const [selected, setSelected] = useState<
    (SharedReport & { files?: any[] }) | null
  >(null);
  const [page, setPage] = useState(1);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const pages = Math.max(1, Math.ceil(reports.length / 12)),
    items = useMemo(
      () => reports.slice((page - 1) * 12, page * 12),
      [reports, page],
    );
  const open = useCallback(async (report: SharedReport) => {
    const response = await fetch(`/api/reports/${report.id}`);
    setSelected(response.ok ? await response.json() : report);
  }, []);
  if (selected)
    return (
      <section className="workspace">
        <button onClick={() => setSelected(null)}>← Back to reports</button>
        <ReportDetails report={selected} />
      </section>
    );
  return (
    <section className="workspace">
      <div className="toolbar">
        <h2>Published reports</h2>
        <span>{reports.length} report(s)</span>
      </div>
      <div className="report-card-grid">
        {items.map((report) => (
          <button
            className="report-card"
            key={report.id}
            onClick={() => void open(report)}
          >
            <span className="report-card-kicker">{report.organisation}</span>
            <h3>{report.title}</h3>
            <p>{report.description || "No description provided."}</p>
            <footer>
              <span>
                {report.periodStart} – {report.periodEnd}
              </span>
              <strong>{report.fileCount} file(s)</strong>
            </footer>
          </button>
        ))}
      </div>
      {!items.length && (
        <p className="empty-state">No published reports yet.</p>
      )}
      <nav className="pagination" aria-label="Report pages">
        <button
          disabled={page === 1}
          onClick={() => setPage((value) => value - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} of {pages}
        </span>
        <button
          disabled={page === pages}
          onClick={() => setPage((value) => value + 1)}
        >
          Next
        </button>
      </nav>
    </section>
  );
}
