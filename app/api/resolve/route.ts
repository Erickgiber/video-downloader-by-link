import { NextRequest } from "next/server";
import ytdl from "ytdl-core";
import * as cheerio from "cheerio";

export const runtime = "nodejs";

type Provider = "youtube" | "facebook" | "twitch" | "x" | "direct" | "unknown";

type ResolveResult = {
  provider: Provider;
  previewUrl: string | null; // iframe src for embeds or direct media URL
  originalUrl: string;
  contentType?: string | null;
  downloadable: boolean; // true only when it's a direct file like mp4/webm/quicktime
  isHls?: boolean;
};

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

function isVideoContentType(ct: string | null | undefined) {
  if (!ct) return false;
  return ct.startsWith("video/") || /(mp4|webm|quicktime)/i.test(ct);
}

function isHlsContentType(ct: string | null | undefined) {
  if (!ct) return false;
  return /application\/(x-mpegURL|vnd\.apple\.mpegurl)/i.test(ct) || /\.m3u8(\?|$)/i.test(ct);
}

function toYoutubeEmbed(u: string) {
  try {
    const parsed = new URL(u);
    if (parsed.hostname.includes("youtube.com")) {
      const v = parsed.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (parsed.hostname.includes("youtu.be")) {
      const id = parsed.pathname.slice(1);
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
  } catch {}
  return null;
}

function toFacebookEmbed(u: string) {
  try {
    const parsed = new URL(u);
    if (!parsed.hostname.includes("facebook.com")) return null;
    const href = encodeURIComponent(u);
    return `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false&height=360`;
  } catch {
    return null;
  }
}

function toTwitchEmbed(u: string, parentHost: string | null) {
  try {
    const parsed = new URL(u);
    if (!parsed.hostname.includes("twitch.tv") && !parsed.hostname.includes("clips.twitch.tv")) return null;
    const parent = parentHost || "localhost";

    if (parsed.hostname.includes("clips.twitch.tv")) {
      const slug = parsed.pathname.split("/").filter(Boolean)[0];
      if (slug) return `https://clips.twitch.tv/embed?clip=${slug}&parent=${parent}&autoplay=false`;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] === "videos" && parts[1]) {
      const id = parts[1];
      return `https://player.twitch.tv/?video=${id}&parent=${parent}&autoplay=false`;
    }
    if (parts[1] === "clip" && parts[2]) {
      const slug = parts[2];
      return `https://clips.twitch.tv/embed?clip=${slug}&parent=${parent}&autoplay=false`;
    }
    if (parts[0]) {
      const channel = parts[0];
      return `https://player.twitch.tv/?channel=${channel}&parent=${parent}&autoplay=false`;
    }
    return null;
  } catch {
    return null;
  }
}

function isXUrl(u: string) {
  try {
    const parsed = new URL(u);
    return parsed.hostname.includes("twitter.com") || parsed.hostname.includes("x.com");
  } catch {
    return false;
  }
}

function getTweetId(u: string): string | null {
  try {
    const parsed = new URL(u);
    // formats: /{user}/status/{id}[/...]
    const parts = parsed.pathname.split("/").filter(Boolean);
    const idx = parts.findIndex((p) => p.toLowerCase() === "status" || p.toLowerCase() === "statuses");
    if (idx !== -1 && parts[idx + 1]) {
      const id = parts[idx + 1].split("?")[0];
      if (/^\d{5,}$/i.test(id)) return id;
    }
    return null;
  } catch {
    return null;
  }
}

async function headContentType(url: string, signal?: AbortSignal) {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: {
        "user-agent": UA,
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      },
      signal,
    });
    const ct = res.headers.get("content-type");
    return { ok: res.ok, status: res.status, contentType: ct };
  } catch {
    return { ok: false, status: 0, contentType: null as string | null };
  }
}

function absolutize(url: string, base: string) {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

async function extractFromHtml(pageUrl: string, html: string): Promise<{ url: string | null; type?: string | null }> {
  const $ = cheerio.load(html);

  const metaCandidates: string[] = [];
  const push = (v?: string | null) => {
    if (v) metaCandidates.push(v);
  };

  // Common meta tags
  push($("meta[property='og:video:secure_url']").attr("content"));
  push($("meta[property='og:video']").attr("content"));
  push($("meta[name='twitter:player:stream']").attr("content"));
  push($("meta[name='twitter:player:stream']").attr("value"));

  // link preload
  $("link[rel='preload'][as='video']").each((_, el) => push($(el).attr("href")));

  // video/source tags
  const vSrc = $("video").attr("src");
  push(vSrc);
  $("video source").each((_, el) => push($(el).attr("src")));

  // JSON-LD contentUrl
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const txt = $(el).contents().text();
      const data = JSON.parse(txt);
      const contentUrl = Array.isArray(data)
        ? data.map((d) => d && d.contentUrl).find(Boolean)
        : data?.contentUrl;
      if (typeof contentUrl === "string") push(contentUrl);
    } catch {}
  });

  // Normalize to absolute and filter
  const absolute = metaCandidates
    .filter(Boolean)
    .map((u) => absolutize(u, pageUrl))
    .filter((u) => /^(https?:)?\/\//.test(u));

  // Prefer mp4/webm first, then m3u8
  const mp4 = absolute.find((u) => /(\.mp4|\.webm|\.mov)(\?|$)/i.test(u));
  if (mp4) return { url: mp4, type: mp4.endsWith(".webm") ? "video/webm" : "video/mp4" };
  const m3u8 = absolute.find((u) => /\.m3u8(\?|$)/i.test(u));
  if (m3u8) return { url: m3u8, type: "application/x-mpegURL" };

  // Fallback to first candidate
  if (absolute[0]) return { url: absolute[0], type: null };
  return { url: null, type: null };
}

async function resolveUrl(req: NextRequest, target: string): Promise<ResolveResult> {
  const originalUrl = target;
  const parentHost = req.headers.get("x-forwarded-host") || req.headers.get("host");

  // Known embed platforms
  const yt = toYoutubeEmbed(target);
  // Para YouTube, mostramos el embed para preview y verificamos si hay formato progresivo descargable
  if (yt) {
    let downloadable = true;
    try {
      const id = ytdl.getURLVideoID(originalUrl);
      const info = await ytdl.getInfo(id);
      downloadable = info.formats.some((f) => f.hasVideo && f.hasAudio);
    } catch {
      // Si falla, dejamos descargable por defecto y lo validamos en /api/download
      downloadable = true;
    }
    // Quemado el "false" temporalmente
    return { provider: "youtube", previewUrl: yt, originalUrl, downloadable: false };
  }
  const fb = toFacebookEmbed(target);
  if (fb) return { provider: "facebook", previewUrl: fb, originalUrl, downloadable: false };
  const tw = toTwitchEmbed(target, parentHost);
  if (tw) return { provider: "twitch", previewUrl: tw, originalUrl, downloadable: false };
  if (isXUrl(target)) {
    const id = getTweetId(target);
    const iframe = id
      ? `https://platform.twitter.com/embed/Tweet.html?id=${id}`
      : `https://twitframe.com/show?url=${encodeURIComponent(target)}`; // fallback
    return { provider: "x", previewUrl: iframe, originalUrl, downloadable: false };
  }

  // If direct media (by HEAD)
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000);
  const head = await headContentType(target, ac.signal);
  clearTimeout(t);
  if (head.ok && (isVideoContentType(head.contentType) || isHlsContentType(head.contentType))) {
    const hls = isHlsContentType(head.contentType);
    return {
      provider: "direct",
      previewUrl: target,
      originalUrl,
      contentType: head.contentType || undefined,
      downloadable: !hls && isVideoContentType(head.contentType),
      isHls: hls,
    };
  }

  // Otherwise, try to fetch HTML and extract media links
  try {
    const pageRes = await fetch(target, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      cache: "no-store",
    });
    const ct = pageRes.headers.get("content-type") || "";
    if (!/text\/html/i.test(ct)) {
      // Unknown non-HTML, still attempt to treat as direct
      const hls = isHlsContentType(ct);
      return {
        provider: "direct",
        previewUrl: target,
        originalUrl,
        contentType: ct,
        downloadable: !hls && isVideoContentType(ct),
        isHls: hls,
      };
    }
    const html = await pageRes.text();
    const extracted = await extractFromHtml(target, html);
    if (extracted.url) {
      const cthead = await headContentType(extracted.url);
      const finalCt = cthead.contentType || extracted.type || null;
      const hls = isHlsContentType(finalCt);
      return {
        provider: "direct",
        previewUrl: extracted.url,
        originalUrl,
        contentType: finalCt || undefined,
        downloadable: !!finalCt && isVideoContentType(finalCt) && !hls,
        isHls: hls,
      };
    }
  } catch {
    // ignore
  }

  return { provider: "unknown", previewUrl: null, originalUrl, downloadable: false };
}

async function parseUrlFromRequest(req: NextRequest): Promise<string | null> {
  if (req.method === "GET") {
    const u = new URL(req.url);
    const target = u.searchParams.get("url");
    return target && isHttpUrl(target) ? target : null;
  }
  if (req.method === "POST") {
    try {
      const body = await req.json();
      const target: string | undefined = body?.url;
      return target && isHttpUrl(target) ? target : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function GET(req: NextRequest) {
  const target = await parseUrlFromRequest(req);
  if (!target) return new Response(JSON.stringify({ error: "Invalid url" }), { status: 400 });
  const result = await resolveUrl(req, target);
  return Response.json(result, { status: 200 });
}

export async function POST(req: NextRequest) {
  const target = await parseUrlFromRequest(req);
  if (!target) return new Response(JSON.stringify({ error: "Invalid url" }), { status: 400 });
  const result = await resolveUrl(req, target);
  return Response.json(result, { status: 200 });
}
