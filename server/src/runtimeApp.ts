import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Upload } from "@aws-sdk/lib-storage";
import type { Db } from "mongodb";
import { parseReportInput } from "../../shared/src/validation.js";
import { log } from "./logger.js";
type FileRec = {
  id: string;
  name: string;
  category: string;
  contentType: string;
  bytes: number;
  key: string;
  downloadUrl: string;
};
type DraftRec = {
  id: string;
  token: string;
  input: ReturnType<typeof parseReportInput>;
  files: FileRec[];
};
type Report = DraftRec["input"] & {
  id: string;
  createdAt: string;
  fileCount: number;
  files: Array<{
    id: string;
    name: string;
    category: string;
    downloadUrl: string;
    previewUrl?: string;
  }>;
};
const drafts = new Map<string, DraftRec>(),
  reports = new Map<string, Report>();
const json = (res: ServerResponse, status: number, data: unknown) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};
const read = async (req: IncomingMessage) => {
  let value = "";
  for await (const part of req) value += part;
  return JSON.parse(value || "{}");
};
const auth = (req: IncomingMessage) =>
  String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
const bucket = process.env.R2_BUCKET || "";
const rawEndpoint =
  process.env.R2_ENDPOINT ||
  `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const endpoint = rawEndpoint.replace(new RegExp(`/${bucket}/?$`), "");
const configured = () =>
  Boolean(
    bucket && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY,
  );
const s3 = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});
const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};
const serveClient = async (req: IncomingMessage, res: ServerResponse) => {
  const dist = normalize(join(process.cwd(), "client", "dist"));
  const requested = req.url === "/" ? "index.html" : (req.url || "/").slice(1);
  const filePath = normalize(join(dist, requested));
  if (
    filePath !== dist &&
    !filePath.startsWith(`${dist}/`) &&
    !filePath.startsWith(`${dist}\\`)
  ) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  try {
    const file = await readFile(filePath);
    res.writeHead(200, {
      "content-type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    });
    res.end(file);
  } catch {
    try {
      const index = await readFile(join(dist, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(index);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  }
};
export function createRuntimeApp(
  options: { ready?: () => Promise<boolean>; db?: Db } = {},
) {
  return createServer(async (req, res) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    res.setHeader("x-request-id", requestId);
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    log.info("http.request.started", { requestId, method: req.method, path: url.pathname });
    res.once("finish", () =>
      log.info("http.request.completed", {
        requestId,
        method: req.method,
        path: url.pathname,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
      }),
    );
    try {
      if (url.pathname === "/api/health")
        return json(res, 200, { ok: true, r2Configured: configured() });
      if (url.pathname === "/api/ready") {
        const ready = options.ready ? await options.ready() : true;
        return json(res, ready && configured() ? 200 : 503, {
          ready: ready && configured(),
          r2Configured: configured(),
        });
      }
      if (url.pathname === "/api/reports" && req.method === "GET") {
        const page = Math.max(1, Number(url.searchParams.get("page") || 1));
        const stored = options.db
          ? await options.db.collection<Report>("reports").find({}).sort({ createdAt: -1 }).toArray()
          : [...reports.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return json(res, 200, {
          items: stored.map(({ files, ...r }) => r),
          page,
          pageSize: 12,
          total: stored.length,
        });
      }
      const detail = url.pathname.match(/^\/api\/reports\/([^/]+)$/);
      if (detail && req.method === "GET") {
        const report = options.db
          ? await options.db.collection<Report>("reports").findOne({ id: detail[1] })
          : reports.get(detail[1]);
        return report
          ? json(res, 200, report)
          : json(res, 404, { error: "report not found" });
      }
      if (url.pathname === "/api/drafts" && req.method === "POST") {
        if (!options.db)
          return json(res, 503, { error: "MongoDB is not connected" });
        const input = parseReportInput(await read(req)),
          id = randomUUID(),
          token = randomUUID();
        drafts.set(id, { id, token, input, files: [] });
        log.info("draft.created", { requestId, draftId: id });
        return json(res, 201, { id, token });
      }
      const reserve = url.pathname.match(/^\/api\/drafts\/([^/]+)\/files$/);
      if (reserve && req.method === "POST") {
        const draft = drafts.get(reserve[1]);
        if (!draft || draft.token !== auth(req))
          return json(res, 404, { error: "draft not found" });
        if (!configured())
          return json(res, 503, { error: "Cloudflare R2 is not configured" });
        const candidate = await read(req),
          id = randomUUID(),
          key = `reports/${draft.id}/${id}`;
        const publicBase = (process.env.R2_PUBLIC_URL || "").replace(/\/$/, "");
        const file: FileRec = {
          id,
          name: candidate.originalName,
          category: candidate.category,
          contentType: candidate.contentType,
          bytes: candidate.bytes,
          key,
          downloadUrl: publicBase ? `${publicBase}/${key}` : "",
        };
        draft.files.push(file);
        log.info("upload.reserved", { requestId, draftId: draft.id, fileId: id, bytes: file.bytes, category: file.category });
        return json(res, 201, {
          id,
          upload: {
            mode: "proxy",
            url: `/api/drafts/${draft.id}/files/${id}/content`,
          },
          file,
        });
      }
      const content = url.pathname.match(
        /^\/api\/drafts\/([^/]+)\/files\/([^/]+)\/content$/,
      );
      if (content && req.method === "PUT") {
        const draft = drafts.get(content[1]);
        if (!draft || draft.token !== auth(req))
          return json(res, 404, { error: "draft not found" });
        const file = draft.files.find((item) => item.id === content[2]);
        if (!file) return json(res, 404, { error: "file not found" });
        log.info("upload.started", { requestId, draftId: draft.id, fileId: file.id, bytes: file.bytes });
        const transfer = new Upload({
          client: s3,
          params: {
            Bucket: bucket,
            Key: file.key,
            Body: req,
            ContentLength: file.bytes,
            ContentType: file.contentType,
          },
          queueSize: 3,
          partSize: 8 * 1024 * 1024,
          leavePartsOnError: false,
        });
        await transfer.done();
        res.writeHead(204);
        res.end();
        log.info("upload.stored", { requestId, draftId: draft.id, fileId: file.id, bytes: file.bytes });
        return;
      }
      const complete = url.pathname.match(
        /^\/api\/drafts\/([^/]+)\/files\/([^/]+)\/complete$/,
      );
      if (complete && req.method === "POST") {
        const draft = drafts.get(complete[1]);
        if (!draft || draft.token !== auth(req))
          return json(res, 404, { error: "draft not found" });
        const file = draft.files.find((item) => item.id === complete[2]);
        if (!file) return json(res, 404, { error: "file not found" });
        const head = await s3.send(
          new HeadObjectCommand({ Bucket: bucket, Key: file.key }),
        );
        if (Number(head.ContentLength) !== file.bytes)
          return json(res, 409, { error: "uploaded file size mismatch" });
        log.info("upload.verified", { requestId, draftId: draft.id, fileId: file.id, bytes: file.bytes });
        return json(res, 200, { verified: true });
      }
      const publish = url.pathname.match(/^\/api\/drafts\/([^/]+)\/publish$/);
      if (publish && req.method === "POST") {
        const draft = drafts.get(publish[1]);
        if (!draft || draft.token !== auth(req))
          return json(res, 404, { error: "draft not found" });
        if (!draft.files.length)
          return json(res, 409, { error: "at least one file is required" });
        const report: Report = {
          ...draft.input,
          id: draft.id,
          createdAt: new Date().toISOString(),
          fileCount: draft.files.length,
          files: draft.files.map((file) => ({
            id: file.id,
            name: file.name,
            category: file.category,
            downloadUrl: file.downloadUrl,
            previewUrl: ["image", "video", "audio", "pdf"].includes(
              file.category,
            )
              ? file.downloadUrl
              : undefined,
          })),
        };
        try {
          if (!options.db) throw new Error("MongoDB is not connected");
          await options.db.collection<Report>("reports").insertOne(report);
          reports.set(report.id, report);
        } catch (error) {
          await Promise.allSettled(
            draft.files.map((file) =>
              s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: file.key })),
            ),
          );
          throw error;
        }
        log.info("report.published", { requestId, reportId: report.id, fileCount: report.fileCount });
        return json(res, 201, report);
      }
      if (!url.pathname.startsWith("/api/")) return serveClient(req, res);
      return json(res, 404, { error: "not found" });
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const validation = name === "ApiError";
      const r2Denied = name === "AccessDenied";
      const status = validation ? 400 : r2Denied ? 502 : 500;
      const message = r2Denied
        ? "Cloudflare R2 denied the upload. Configure an R2 API token with Object Read & Write permission for this bucket."
        : error instanceof Error
          ? error.message
          : "request failed";
      log.error("http.request.failed", {
        requestId,
        method: req.method,
        path: url.pathname,
        status,
        error: message,
      });
      return json(res, status, { error: message });
    }
  });
}
