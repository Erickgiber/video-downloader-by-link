import { NextRequest } from "next/server";
import * as cheerio from "cheerio";

export const runtime = "nodejs";

type Provider = "youtube" | "facebook" | "twitch" | "x" | "instagram" | "direct" | "unknown";

type ResolveResult = {
  provider: Provider;
  previewUrl: string | null; // iframe src for embeds or direct media URL
  originalUrl: string;
  contentType?: string | null;
  downloadable: boolean; // true only when it's a direct file like mp4/webm/quicktime
  isHls?: boolean;
  embedHtml?: string | null; // oEmbed HTML for Instagram/Facebook embeds
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Helper function to safely check if a hostname matches a domain
// Prevents URL substring sanitization vulnerabilities
function isValidHostname(hostname: string, ...allowedDomains: string[]): boolean {
  const lower = hostname.toLowerCase();
  for (const domain of allowedDomains) {
    if (lower === domain || lower === `www.${domain}` || lower.endsWith(`.${domain}`)) {
      return true;
    }
  }
  return false;
}

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
    if (isValidHostname(parsed.hostname, "youtube.com")) {
      const v = parsed.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
    }
    if (isValidHostname(parsed.hostname, "youtu.be")) {
      const id = parsed.pathname.slice(1);
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
  } catch {}
  return null;
}

function toTwitchEmbed(u: string, parentHost: string | null) {
  try {
    const parsed = new URL(u);
    if (!isValidHostname(parsed.hostname, "twitch.tv", "clips.twitch.tv")) return null;
    const parent = parentHost || "localhost";

    if (isValidHostname(parsed.hostname, "clips.twitch.tv")) {
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
    return isValidHostname(parsed.hostname, "twitter.com", "x.com");
  } catch {
    return false;
  }
}

function isInstagramUrl(u: string) {
  try {
    const parsed = new URL(u);
    return isValidHostname(parsed.hostname, "instagram.com");
  } catch {
    return false;
  }
}

function isFacebookUrl(u: string) {
  try {
    const parsed = new URL(u);
    return isValidHostname(parsed.hostname, "facebook.com", "fb.watch");
  } catch {
    return false;
  }
}

function unwrapKnownRedirects(u: string): string {
  try {
    const parsed = new URL(u);
    // Facebook outbound redirect: https://l.facebook.com/l.php?u=...
    if (isValidHostname(parsed.hostname, "facebook.com") && parsed.hostname.toLowerCase().startsWith("l.")) {
      const out = parsed.searchParams.get("u");
      if (out && isHttpUrl(out)) return out;
    }
    // Instagram outbound redirect: https://l.instagram.com/?u=...
    if (isValidHostname(parsed.hostname, "instagram.com") && parsed.hostname.toLowerCase().startsWith("l.")) {
      const out = parsed.searchParams.get("u");
      if (out && isHttpUrl(out)) return out;
    }
  } catch {
    // ignore
  }
  return u;
}

function normalizeInstagramPermalink(u: string): string | null {
  try {
    const parsed = new URL(u);
    if (!isValidHostname(parsed.hostname, "instagram.com")) return null;

    // Keep only paths that Instagram supports for embed.
    const parts = parsed.pathname.split("/").filter(Boolean);
    const kind = (parts[0] || "").toLowerCase();
    if (kind !== "p" && kind !== "reel" && kind !== "tv") return null;
    if (!parts[1]) return null;

    const clean = new URL(parsed.toString());
    clean.protocol = "https:";
    clean.hostname = "www.instagram.com";
    clean.search = "";
    clean.hash = "";
    clean.pathname = `/${kind}/${parts[1]}/`;
    return clean.toString();
  } catch {
    return null;
  }
}

function buildInstagramEmbedHtml(u: string): string | null {
  const permalink = normalizeInstagramPermalink(u);
  if (!permalink) return null;
  const safePermalink = escapeHtmlAttr(permalink);

  // Official Instagram embed markup; embed.js (loaded client-side) will render it.
  // If the user is logged in, Instagram can use their existing cookies inside the iframe context.
  return `\
<blockquote class="instagram-media" data-instgrm-permalink="${safePermalink}" data-instgrm-version="14" style="background:#FFF; border:0; border-radius:12px; box-shadow:0 1px 10px rgba(0,0,0,0.08); margin: 0 auto; max-width:540px; min-width: 326px; width:100%;">\
  <div style="padding:16px;">\
    <a href="${safePermalink}" target="_blank" rel="noopener noreferrer" style="color:#3897f0; text-decoration:none;">Ver en Instagram</a>\
  </div>\
</blockquote>`;
}

function buildFacebookEmbedUrl(u: string): string | null {
  try {
    const parsed = new URL(u);
    if (!isValidHostname(parsed.hostname, "facebook.com", "fb.watch")) return null;

    // The Facebook Video plugin supports many URL types (videos, reels, fb.watch).
    const href = encodeURIComponent(u);
    return `https://www.facebook.com/plugins/video.php?href=${href}&show_text=false&height=360&width=560`;
  } catch {
    return null;
  }
}

function buildFacebookEmbedHtml(u: string): string | null {
  const embed = buildFacebookEmbedUrl(u);
  if (!embed) return null;
  const safe = escapeHtmlAttr(embed);
  return `\
<iframe\
  src="${safe}"\
  style="border:none; overflow:hidden; width:100%; height:100%;"\
  scrolling="no"\
  frameborder="0"\
  allowfullscreen="true"\
  allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"\
></iframe>`;
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

async function instagramOEmbed(url: string): Promise<string | null> {
  try {
    // Validate that URL is actually from Instagram domain
    const parsed = new URL(url);
    if (!isValidHostname(parsed.hostname, "instagram.com")) {
      return null;
    }
    
    const oembedUrl = `https://api.instagram.com/oembed/?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.html || null;
  } catch {
    return null;
  }
}

async function facebookOEmbed(url: string): Promise<string | null> {
  try {
    // Validate that URL is actually from Facebook domain
    const parsed = new URL(url);
    if (!isValidHostname(parsed.hostname, "facebook.com")) {
      return null;
    }
    
    const oembedUrl = `https://www.facebook.com/plugins/video/oembed.json/?url=${encodeURIComponent(url)}`;
    const res = await fetch(oembedUrl, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.html || null;
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

  // Common meta tags - expanded with og:video:url and twitter:player
  push($("meta[property='og:video:secure_url']").attr("content"));
  push($("meta[property='og:video:url']").attr("content"));
  push($("meta[property='og:video']").attr("content"));
  push($("meta[name='twitter:player:stream']").attr("content"));
  push($("meta[name='twitter:player:stream']").attr("value"));
  push($("meta[name='twitter:player']").attr("content"));
  push($("meta[property='twitter:player']").attr("content"));

  // link preload
  $("link[rel='preload'][as='video']").each((_, el) => push($(el).attr("href")));

  // video/source tags
  const vSrc = $("video").attr("src");
  push(vSrc);
  $("video source").each((_, el) => push($(el).attr("src")));

  // JSON-LD contentUrl with robust traversal
  $("script[type='application/ld+json']").each((_, el) => {
    try {
      const txt = $(el).contents().text();
      const data = JSON.parse(txt);
      
      // Helper to recursively find contentUrl in nested objects/arrays with depth limiting
      const findContentUrl = (obj: unknown, depth = 0): string | null => {
        if (!obj || depth > 10) return null; // Limit recursion depth to prevent excessive processing
        if (typeof obj === 'string') return null;
        if (Array.isArray(obj)) {
          for (const item of obj) {
            const found = findContentUrl(item, depth + 1);
            if (found) return found;
          }
          return null;
        }
        if (typeof obj === 'object') {
          const objRecord = obj as Record<string, unknown>;
          if (objRecord.contentUrl && typeof objRecord.contentUrl === 'string') {
            return objRecord.contentUrl;
          }
          // Check nested properties
          for (const key in objRecord) {
            const found = findContentUrl(objRecord[key], depth + 1);
            if (found) return found;
          }
        }
        return null;
      };
      
      const contentUrl = findContentUrl(data);
      if (contentUrl) push(contentUrl);
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
  target = unwrapKnownRedirects(target);
  const parentHost = req.headers.get("x-forwarded-host") || req.headers.get("host");

  // Instagram support
  if (isInstagramUrl(target)) {
    // Prefer official embed markup (works better for Reels, and can leverage user cookies if logged in).
    const official = buildInstagramEmbedHtml(target);
    if (official) {
      return {
        provider: "instagram",
        previewUrl: null,
        originalUrl,
        downloadable: false,
        embedHtml: official,
      };
    }

    // Fallback to oEmbed (may fail without access token depending on Instagram policy).
    const embedHtml = await instagramOEmbed(target);
    return {
      provider: "instagram",
      previewUrl: null,
      originalUrl,
      downloadable: false,
      embedHtml: embedHtml || null,
    };
  }

  // Known embed platforms
  const yt = toYoutubeEmbed(target);
  // Para YouTube, mostramos el embed para preview y verificamos si hay formato progresivo descargable
  if (yt) {
    // Quemado el "false" temporalmente - YouTube downloads disabled
    return { provider: "youtube", previewUrl: yt, originalUrl, downloadable: false };
  }
  
  if (isFacebookUrl(target)) {
    const previewUrl = buildFacebookEmbedUrl(target);
    const embedHtml = buildFacebookEmbedHtml(target);

    // Also try oEmbed (nice-to-have), but keep our official iframe as the stable baseline.
    let oembed: string | null = null;
    try {
      oembed = await facebookOEmbed(target);
    } catch {
      // ignore
    }

    return {
      provider: "facebook",
      previewUrl: previewUrl || null,
      originalUrl,
      downloadable: false,
      embedHtml: oembed || embedHtml,
    };
  }
  
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
