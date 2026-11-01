# Apuntador de Audio

Teleprompter que sigue un audio línea a línea. Cargas un MP3 (o M4A, WAV, OGG…) y su archivo de subtítulos `.srt` o `.vtt`. La línea que suena queda siempre a la altura de la flecha y se resalta palabra a palabra. Si no tienes el SRT, la app puede **transcribir el audio con Whisper dentro del navegador**: el audio nunca sale de tu equipo.

Es una página estática (HTML, CSS y JavaScript sin dependencias de build), lista para GitHub Pages.

## Funciones

- Seguimiento automático de la línea activa, con resaltado palabra a palabra estimado.
- Toca una línea para saltar a ese momento. Si te desplazas a mano, el seguimiento se pausa hasta que pulses «Volver a la línea actual».
- Tamaño de letra, velocidad (0,75× a 2×), ajuste de sincronía en décimas de segundo y modo espejo para cristales de teleprompter.
- Biblioteca: cada guion se guarda con el punto donde te quedaste, y su audio se reabre solo.
- Transcripción con Whisper Tiny (~44 MB) o Base (~80 MB), en español, inglés, portugués, francés, italiano, alemán o detección automática.

### Teclado

| Tecla | Acción |
| --- | --- |
| `Espacio` | Reproducir o pausar |
| `←` `→` | Saltar 5 segundos |
| `↑` `↓` | Línea anterior o siguiente |
| `+` `−` | Tamaño del texto |
| `M` / `F` | Modo espejo / pantalla completa |
| `B` | Abrir la biblioteca |

## Probarlo en local

La página necesita un servidor: abierta como `file://`, el navegador bloquea el worker de transcripción y la caché de los modelos.

```sh
python3 -m http.server 8000
# abre http://localhost:8000
```

Cualquier otro servidor estático sirve igual (`npx serve`, la extensión Live Server de VS Code, etc.).

## Publicar en GitHub Pages

1. Sube el repositorio a GitHub.
2. En **Settings → Pages**, en *Build and deployment*, elige **Deploy from a branch**, la rama `main` y la carpeta `/ (root)`.
3. En uno o dos minutos la app queda en `https://<tu-usuario>.github.io/<nombre-del-repo>/`.

Todas las rutas son relativas, así que funciona igual en un subdirectorio de proyecto que en un dominio propio. El archivo `.nojekyll` evita que GitHub procese el sitio con Jekyll.

## Estructura

```
index.html        Marcado de la app
css/styles.css    Estilos (tema claro y oscuro automático)
js/app.js         Reproductor, parser de SRT/VTT, biblioteca e interfaz de transcripción
js/worker.js      Web Worker que ejecuta Whisper con transformers.js
favicon.svg
```

## Dónde se guardan los datos

Todo queda en el navegador de quien usa la app. No hay servidor propio ni cuentas.

| Qué | Dónde |
| --- | --- |
| Ajustes, lista de guiones, líneas y posición | `localStorage` |
| Archivos de audio de la biblioteca | IndexedDB (base `apuntador`) |
| Modelos Whisper y runtime WASM | Cache Storage (`transformers-cache` y `apuntador-runtime`) |

Los modelos se descargan **una sola vez**. Desde el diálogo de transcripción puedes borrar cada modelo para liberar espacio.

## Dependencias externas

La app no incluye binarios en el repositorio. Los carga desde estos servicios:

- **[transformers.js](https://github.com/huggingface/transformers.js) 3.8.1** y su runtime ONNX en WASM, desde jsDelivr (versión fija en `js/app.js`, constante `TJS_VERSION`).
- **Modelos** [`Xenova/whisper-tiny`](https://huggingface.co/Xenova/whisper-tiny) y [`Xenova/whisper-base`](https://huggingface.co/Xenova/whisper-base) (cuantizados a 8 bits), desde Hugging Face.
- **Fuentes** Atkinson Hyperlegible e IBM Plex Mono, desde Google Fonts.

Si cambias de versión de transformers.js, actualiza también `RUNTIME.wasmSize` en `js/app.js`. Ese tamaño solo se usa para la barra de progreso.

GitHub Pages no envía las cabeceras COOP/COEP, así que ONNX Runtime funciona con un solo hilo (`numThreads = 1`). La transcripción sirve igual, aunque más lenta que con varios hilos.
