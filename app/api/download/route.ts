import { NextRequest } from "next/server";

export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

function isHttpUrl(u: string) {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

function inferFileName(target: string) {
  try {
    const { pathname } = new URL(target);
    const last = pathname.split("/").pop() || "video";
    if (/(\.\w{2,5})$/.test(last)) return last;
    return `${last}.mp4`;
  } catch {
    return "video.mp4";
  }
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const target = u.searchParams.get("url");
  if (!target || !isHttpUrl(target)) return new Response("Invalid url", { status: 400 });

  const upstream = await fetch(target, {
    redirect: "follow",
    headers: {
      "user-agent": UA,
      accept: "*/*",
      // Some CDNs require an Origin to be set; spoof our own host as origin
      ...(req.headers.get("host") ? { origin: `https://${req.headers.get("host")}` } : {}),
    },
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream error: ${upstream.status}`, { status: upstream.status || 502 });
  }

  const headers = new Headers();
  const ct = upstream.headers.get("content-type") || "application/octet-stream";
  const cl = upstream.headers.get("content-length");
  if (ct) headers.set("content-type", ct);
  if (cl) headers.set("content-length", cl);
  const filename = inferFileName(target);
  headers.set("content-disposition", `attachment; filename="${filename}"`);
  // Disable caching for safety
  headers.set("cache-control", "no-store");

  return new Response(upstream.body, { status: 200, headers });
}
