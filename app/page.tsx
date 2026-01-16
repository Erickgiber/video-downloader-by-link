"use client"

import React, { useEffect, useRef, useState } from "react";

// TypeScript declaration for Instagram embed
declare global {
  interface Window {
    instgrm?: {
      Embeds?: {
        process: () => void;
      };
    };
  }
}

export default function Page() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [url, setUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [provider, setProvider] = useState<"youtube" | "direct" | "facebook" | "x" | "twitch" | "instagram" | "unknown" | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [downloadable, setDownloadable] = useState(false);
  const [isHls, setIsHls] = useState(false);
  const [embedHtml, setEmbedHtml] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // initialize theme from localStorage or system
  useEffect(() => {
    try {
      const saved = localStorage.getItem("vd_theme");
      if (saved === "light" || saved === "dark" || saved === "system") {
        const themeVal = saved as "light" | "dark" | "system";
        setTheme(themeVal);
        applyTheme(themeVal);
      } else {
        setTheme("system");
        applyTheme("system");
      }
    } catch {
      setTheme("system");
    }
  }, []);

  // Load Instagram embed script when Instagram embed is present
  useEffect(() => {
    if (provider === "instagram" && embedHtml) {
      // Load Instagram embed script if not already loaded
      if (!document.querySelector('script[src="https://www.instagram.com/embed.js"]')) {
        const script = document.createElement("script");
        script.src = "https://www.instagram.com/embed.js";
        script.async = true;
        document.body.appendChild(script);
        script.onload = () => {
          // Process embeds after script loads
          if (window.instgrm?.Embeds?.process) {
            window.instgrm.Embeds.process();
          }
        };
      } else {
        // Script already loaded, just process embeds
        setTimeout(() => {
          if (window.instgrm?.Embeds?.process) {
            window.instgrm.Embeds.process();
          }
        }, 100);
      }
    }
  }, [provider, embedHtml]);

  function applyTheme(t: "light" | "dark" | "system") {
    try {
      const el = document.documentElement;
      if (t === "system") {
        el.removeAttribute("data-theme");
      } else {
        el.setAttribute("data-theme", t);
      }
    } catch {
      // ignore
    }
  }

  function handleSetTheme(t: "light" | "dark" | "system", event: React.MouseEvent<HTMLButtonElement>) {
    setTheme(t);
    event.currentTarget.blur();
    try { localStorage.setItem("vd_theme", t); } catch {}
    applyTheme(t);
  }

  function validUrl(u: string) {
    try {
      // basic validation
      const parsed = new URL(u);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  async function handlePreview(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!url.trim()) {
      setToast("Ingresa una URL válida");
      return;
    }
    if (!validUrl(url.trim())) {
      setToast("La URL no es válida");
      return;
    }

    setLoadingPreview(true);
    setPreviewUrl(null);
    setProvider(null);
    setDownloadable(false);
    setIsHls(false);
    setEmbedHtml(null);

    // small delay so loading UI is visible
    await new Promise((r) => setTimeout(r, 250));
    const cleaned = url.trim();
    try {
      const res = await fetch(`/api/resolve?url=${encodeURIComponent(cleaned)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("resolve failed");
      const data: {
        provider: "youtube" | "facebook" | "twitch" | "x" | "instagram" | "direct" | "unknown";
        previewUrl: string | null;
        downloadable: boolean;
        isHls?: boolean;
        embedHtml?: string | null;
      } = await res.json();

      setProvider(data.provider);
      setPreviewUrl(data.previewUrl);
      setDownloadable(!!data.downloadable);
      setIsHls(!!data.isHls);
      setEmbedHtml(data.embedHtml || null);

      // Para X/Twitter ahora usamos iframe oficial, no requiere widgets.js
    } catch (err) {
      console.error(err);
      setToast("No se pudo resolver el enlace");
      setProvider("unknown");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleDownload() {
    if (!previewUrl && !url) return;
    // If not supported, do nothing (button should already be disabled)
    if (!downloadable || (provider === "direct" && isHls)) return;

    // Para YouTube enviamos la URL original; para otros usamos la previewUrl directa
    const srcForDownload = provider === "youtube" ? url : (previewUrl || url);
    if (!srcForDownload) return;

    // Utilizamos fetch para obtener el archivo como Blob y disparar la descarga sin abrir pestañas
    setDownloadLoading(true);
    setToast("Se está descargando el video...");

    function filenameFromContentDisposition(cd: string | null): string | null {
      if (!cd) return null;
      // filename*=UTF-8''...
      const star = cd.match(/filename\*=(?:UTF-8''|)([^;\r\n]+)/i);
      if (star && star[1]) {
        try { return decodeURIComponent(star[1].replace(/^"|"$/g, "")); } catch {}
      }
      const normal = cd.match(/filename=("?)([^";\r\n]+)\1/i);
      if (normal && normal[2]) return normal[2];
      return null;
    }

    try {
      const proxyUrl = `/api/download?url=${encodeURIComponent(srcForDownload)}`;
      const res = await fetch(proxyUrl, { method: "GET" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `Fallo al descargar. Código ${res.status}`);
      }

      const blob = await res.blob();
      const cd = res.headers.get("content-disposition");
      const suggested = filenameFromContentDisposition(cd);
      const fallbackExt = provider === "youtube" ? ".mp4" : "";
      const fallbackName = (url.split("/").pop() || "video") + fallbackExt;
      const filename = (suggested || fallbackName).replace(/[\\/:*?"<>|]+/g, " ").trim();

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename || "video";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

      setToast("Descarga iniciada");
    } catch (err: unknown) {
      console.error(err);
      const msg = (err && typeof err === 'object' && 'message' in err && typeof err.message === 'string') ? err.message : "Ocurrió un error al descargar el video";
      setToast(msg);
    } finally {
      setDownloadLoading(false);
    }
  }

  function handleClear() {
    try {
      // stop any playing video
      if (videoRef.current) {
        videoRef.current.pause();
      }
    } catch {}
    setUrl("");
    setPreviewUrl(null);
    setProvider(null);
    setDownloadable(false);
    setIsHls(false);
    setEmbedHtml(null);
    setLoadingPreview(false);
    setDownloadLoading(false);
    setToast(null);
  }

  async function handleShare() {
    if (!previewUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Video", url });
        setToast("Compartido");
      } catch {
        setToast("Cancelado");
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setToast("Enlace copiado al portapapeles");
    } catch {
      // fallback: open new tab
      window.open(url, "_blank");
      setToast("No se pudo acceder al portapapeles. Abriendo enlace...");
    }
  }

  return (
    <main className="min-h-screen bg-app text-app flex items-center justify-center p-6">
      <div className="w-full max-w-3xl">
        <div className="card shadow-lg rounded-2xl p-6 sm:p-10">
          <h1 className="text-xl sm:text-2xl font-semibold text-app">Descargar y compartir videos</h1>
          <div className="mt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
            <p className="text-sm muted">Pega un enlace de video (YouTube, Instagram, Facebook o enlace directo) y previsualiza antes de descargar o compartir.</p>
            <div className="sm:ml-4 inline-flex items-center gap-2">
              <span className="text-xs muted">Tema</span>
              <div className={`segmented ${theme === "light" ? "pos-light" : theme === "system" ? "pos-system" : "pos-dark"}`} role="tablist" aria-label="Tema">
                <div className="knob" aria-hidden />
                <button type="button" onClick={(e) => handleSetTheme("light", e)} className={`option ${theme === "light" ? "active" : ""}`} aria-pressed={theme === "light"} aria-label="Tema claro" data-tooltip="Claro">
                  {/* Sun icon */}
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5l-1.5-1.5M20.5 20.5 19 19M5 19l-1.5 1.5M20.5 3.5 19 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
                <button type="button" onClick={(e) => handleSetTheme("system", e)} className={`option ${theme === "system" ? "active" : ""}`} aria-pressed={theme === "system"} aria-label="Usar tema del sistema" data-tooltip="Sistema">
                  {/* Monitor/system icon */}
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5"/>
                    <path d="M8 20h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
                <button type="button" onClick={(e) => handleSetTheme("dark", e)} className={`option ${theme === "dark" ? "active" : ""}`} aria-pressed={theme === "dark"} aria-label="Tema oscuro" data-tooltip="Oscuro">
                  {/* Moon icon */}
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <form onSubmit={handlePreview} className="mt-6">
            <label className="block text-sm font-medium text-app">Enlace del video</label>
            <div className="mt-2 flex flex-col sm:flex-row gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className="w-full sm:flex-1 input"
                aria-label="Enlace del video"
              />
              <button
                type="submit"
                disabled={loadingPreview || !url.trim()}
                className="w-full sm:w-auto btn-primary px-4 py-3 font-medium shadow-md focus:outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                Previsualizar video
              </button>
              {(url.trim().length > 0 || !!previewUrl) && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="w-full sm:w-auto btn-ghost px-4 py-3 font-medium hover:shadow cursor-pointer"
                  aria-label="Limpiar enlace y previsualización"
                >
                  Limpiar
                </button>
              )}
            </div>
          </form>

          <div className="mt-6">
            {!previewUrl && !embedHtml && (
              <div className="rounded-lg p-6 text-center muted border border-dashed border-(--border)">
                <p>Para comenzar, introduce un enlace y pulsa &quot;Previsualizar video&quot;.</p>
                <p className="mt-3 text-sm">Existen videos que no son descargables por causa de algun formato o el proveedor.</p>
              </div>
            )}

            {loadingPreview && (
              <div className="mt-4 flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 spinner"></div>
              </div>
            )}

            {(previewUrl || embedHtml) && !loadingPreview && (
              <div className="mt-4 space-y-4 fade-in">
                <div className="rounded-lg overflow-hidden preview-bg preview-container">
                  {embedHtml ? (
                    // Render embedHtml from oEmbed (Instagram/Facebook)
                    <div className="preview-embed-wrapper" dangerouslySetInnerHTML={{ __html: embedHtml }} />
                  ) : provider === "youtube" || provider === "facebook" || provider === "twitch" || provider === "x" ? (
                    <div className="preview-embed-wrapper">
                      <iframe
                        src={previewUrl || undefined}
                        title="Embed preview"
                        className="preview-embed"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                      />
                    </div>
                  ) : previewUrl ? (
                    <div className="preview-embed-wrapper">
                      <video
                        ref={videoRef}
                        controls
                        src={previewUrl || undefined}
                        className="preview-video"
                      >
                        Tu navegador no soporta la etiqueta video.
                      </video>
                    </div>
                  ) : null}
                </div>

                {/* Warning banner when download is not supported */}
                {(!downloadable || (provider === "direct" && isHls)) && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="w-full border bg-(--warning-bg) text-(--warning-text) border-(--warning-border) rounded-lg py-2.5 px-3"
                  >
                    {provider === "instagram" || provider === "facebook"
                      ? "Este video no es descargable desde Instagram/Facebook. Puedes verlo en el sitio original."
                      : "No es posible descargar este video: el proveedor o formato es incompatible para su descarga."}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleDownload}
                      disabled={downloadLoading || !downloadable || (provider === "direct" && isHls)}
                      className="disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer w-full sm:flex-1 inline-flex items-center justify-center gap-2 btn-primary px-4 py-3 font-medium shadow"
                  >
                    {downloadLoading ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="white" strokeWidth="4" strokeOpacity="0.25"/></svg>
                        Descargando...
                      </>
                    ) : (
                      "Descargar"
                    )}
                  </button>

                  {(provider === "instagram" || provider === "facebook") && (
                    <button
                      onClick={() => window.open(url, "_blank")}
                      className="cursor-pointer w-full sm:flex-1 inline-flex items-center justify-center gap-2 btn-ghost px-4 py-3 font-medium hover:shadow"
                    >
                      Abrir en {provider === "instagram" ? "Instagram" : "Facebook"}
                    </button>
                  )}

                  <button
                    onClick={handleShare}
                    className="cursor-pointer w-full sm:flex-1 inline-flex items-center justify-center gap-2 btn-ghost px-4 py-3 font-medium hover:shadow"
                  >
                    Compartir
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* toast */}
        {toast && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
            <div className="toast">{toast}</div>
          </div>
        )}
      </div>
    </main>
  );
}
