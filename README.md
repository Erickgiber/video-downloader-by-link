<div align="center">

# 🚀 Video Downloader by Link

Aplicación web en Next.js para previsualizar enlaces de video y descargar archivos de video cuando es posible (incluye soporte para YouTube mediante ytdl-core).

</div>

## ✨ ¿Qué hace esta aplicación?

Pega un enlace de un video público y la app intentará:

- Identificar el proveedor: YouTube, Facebook, Twitch, X (Twitter) u otros.
- Mostrar una previsualización usando el reproductor oficial (embeds) cuando aplica.
- Resolver enlaces directos a archivos de video (p. ej., .mp4, .webm) desde páginas compatibles.
- Permitir la descarga del archivo cuando sea posible. Para YouTube, la descarga se realiza en el servidor usando `ytdl-core` (formato progresivo disponible, priorizando MP4).

Soporta previsualización para:

- YouTube (embed)
- Facebook (embed)
- Twitch (canales, videos y clips – embed)
- X/Twitter (embed oficial)
- Enlaces directos (p. ej., https://…/video.mp4) con reproductor nativo del navegador

Limitaciones importantes:

- No descarga streams HLS (.m3u8) ni contenidos con DRM o que requieran autenticación.
- En YouTube, si no existe un formato progresivo (video+audio) disponible, la descarga puede no estar disponible sin procesamiento adicional (ej. ffmpeg para muxear). Este proyecto no integra ffmpeg.
- Algunos sitios pueden bloquear el acceso por CORS, restricciones regionales o políticas del servidor.
- Sólo funciona con contenido público y accesible.

## 🧱 Arquitectura (resumen)

- Frontend: `app/page.tsx` (App Router, React 19) para UI, tema claro/oscuro y previsualización.
- API interna:
	- `GET/POST /api/resolve?url=…` — Detecta proveedor y obtiene URL de previsualización/descarga.
	- `GET /api/download?url=…` — Descarga de YouTube con `ytdl-core` y proxy para archivos de video directos.
- Extracción HTML: se apoyan metatags, video/source, link preload y JSON‑LD para encontrar medios.

## ✅ Requisitos

- Node.js 18.18+ o 20+ (recomendado LTS). Next.js 16 requiere Node moderno.
- npm (o yarn/pnpm/bun si prefieres).

## 🚀 Cómo correr el proyecto (local)

1) Clonar e instalar dependencias

```powershell
git clone https://github.com/Erickgiber/video-downloader-by-link.git
cd video-downloader-by-link
npm install
```

2) Ambiente de desarrollo

```powershell
npm run dev
```

Luego abre http://localhost:3000 en tu navegador.

3) Compilar para producción

```powershell
npm run build
npm start
```

4) Linter (opcional)

```powershell
npm run lint
```

Notas:

- No se requieren variables de entorno para uso básico.
- Puedes usar `yarn`, `pnpm` o `bun` si lo prefieres, ajustando los comandos.

## 🧪 Ejemplos de uso (API)

La UI utiliza estos endpoints internos. Puedes consumirlos también desde herramientas como curl o Postman.

1) Resolver un enlace

```text
GET /api/resolve?url={URL}
```

Respuesta (ejemplo):

```json
{
	"provider": "direct | youtube | facebook | twitch | x | unknown",
	"previewUrl": "https://…",   
	"originalUrl": "https://…",
	"contentType": "video/mp4",
	"downloadable": true,
	"isHls": false
}
```

También acepta `POST /api/resolve` con body JSON `{ "url": "https://…" }`.

2) Descargar a través del servidor (YouTube y enlaces directos)

```text
GET /api/download?url={URL_DE_VIDEO_O_EMBED}
```

Devuelve el stream con cabecera `Content-Disposition` para disparar la descarga en el navegador. Para URLs de YouTube (watch, short, embed o youtu.be), el servidor usa `ytdl-core` para seleccionar un formato progresivo (priorizando MP4) y enviarlo al navegador.

## ⚠️ Consideraciones y límites

- HLS (.m3u8) y contenidos con DRM no son descargables por esta herramienta.
- Videos privados, con paywall o que requieren sesión no pueden resolverse.
- Respeta los Términos de Servicio de cada plataforma y las leyes de derechos de autor.

## 🛠️ Solución de problemas

- “No se pudo resolver el enlace”: verifica que la URL sea pública y accesible.
- “No es posible descargar este video”: suele ser HLS/DRM o el servidor bloquea descargas directas.
- Errores 403/404/5xx al descargar: el servidor de origen puede tener restricciones de CORS/origen o límites.
- Asegúrate de usar Node 18.18+ / 20+ y reinstalar dependencias si cambiaste de versión (`rm -rf node_modules && npm install`).

## 📁 Estructura del proyecto

```
app/
	api/
		download/route.ts   # Proxy de descarga para archivos directos
		resolve/route.ts    # Detección de proveedor y extracción de medios
	page.tsx              # UI principal
	layout.tsx, globals.css, ...
```

## 📜 Licencia y aviso legal

Este proyecto se proporciona con fines educativos. Tú eres responsable del uso que hagas de la herramienta y de respetar los Términos de Servicio y derechos de autor de los contenidos que descargues o previsualices. No se promueve el uso indebido ni la descarga de contenido protegido.

---

Hecho con Next.js 16, React 19 y cariño 💙
