# Apuntador de Audio

Teleprompter que sigue un audio línea a línea. Cargas un MP3 (o M4A, WAV, OGG…) y su archivo de subtítulos `.srt` o `.vtt`. La línea que suena queda siempre a la altura de la flecha y se resalta palabra a palabra. Si no tienes el SRT, la app puede **transcribir el audio con Whisper dentro del navegador**: el audio nunca sale de tu equipo.

Es una página estática (HTML, CSS y JavaScript sin dependencias de build), lista para GitHub Pages.

## Funciones

- Seguimiento automático de la línea activa, con resaltado palabra a palabra. Es exacto en lo transcrito con tiempos por palabra; en los SRT, se estima.
- Toca una línea para saltar a ese momento. Si te desplazas a mano, el seguimiento se pausa hasta que pulses «Volver a la línea actual».
- Tamaño de letra, velocidad (0,75× a 2×), ajuste de sincronía en décimas de segundo y modo espejo para cristales de teleprompter.
- Biblioteca por audio: cada audio se guarda con todos sus textos (SRT y transcripciones de distintos modelos), cada uno con el punto donde te quedaste. Al volver a cargar un audio aparecen sus textos para elegir.
- Transcripción con Whisper en español, inglés, portugués, francés, italiano, alemán o detección automática. Los modelos disponibles están en la tabla de abajo.

### Modelos de transcripción

Cada modelo puede correr en el procesador (**CPU**, WASM, funciona en cualquier navegador) o en la tarjeta gráfica (**GPU**, WebGPU). Large v3 Turbo es la excepción: solo corre en GPU. Las variantes de GPU usan otros archivos, más grandes, porque los de 8 bits rinden mal en la GPU.

| Modelo | Descarga CPU | Descarga GPU | 56 s de voz en CPU | En GPU | Errores (WER) | Auto usa |
| --- | --- | --- | --- | --- | --- | --- |
| Tiny | 44 MB | 122 MB | 12 s | 8–10 s | 6–8 % | CPU |
| Base | 80 MB | 209 MB | 25 s | 11 s | 2–3 % | GPU |
| Small | 252 MB | 413 MB (589 MB sin fp16) | 43 s | 9–15 s | 1 % | GPU |
| Large v3 Turbo | — | 1,6 GB | — | 23–35 s | 1 % | GPU |

**Cómo se midió:**
- **Tiempos:** son solo de la transcripción, con tiempos por palabra. No incluyen la descarga ni la carga del modelo (1 a 3 s; en Turbo, de 16 a 75 s).
- **Errores (WER):** porcentaje de palabras mal transcritas respecto al guion original.
- **Condiciones:** un Mac con Apple Silicon y Chrome, voz sintética en español. En este equipo la GPU rindió muy distinto de una sesión a otra, así que los tiempos son orientativos.

Los modelos son las versiones [`_timestamped`](https://huggingface.co/onnx-community/whisper-small_timestamped) de onnx-community. Además de permitir tiempos por palabra, igualan en precisión a las de Xenova que usaba la app antes y son mucho más rápidas en GPU: Small tardó 9–15 s frente a 60–122 s, en mediciones alternadas.

### Tiempos por palabra

Con **Ajustes → Transcripción → Tiempos por palabra** activado (lo está por defecto), Whisper devuelve cuándo empieza cada palabra:
- **El resaltado sigue la voz real.** Sin esta opción, la app reparte la duración de cada línea entre sus palabras, que es lo que sigue haciendo con los SRT.
- **Cómo se arman las líneas:** las palabras se agrupan cortando en las pausas, al final de cada oración, en una coma si la línea ya es larga, o como mucho a las 20 palabras.
- **Se guardan en la biblioteca** junto con el texto.
- **Coste:** la transcripción tarda entre un 6 y un 12 % más. Si va lenta, desactiva la opción: vuelve al modo por frases y usa los mismos archivos, sin descargar nada.

**Large v3 Turbo** necesita WebGPU con soporte de 16 bits (`shader-f16`): Chrome o Edge recientes, y Safari 26 o posterior. Usa el codificador en fp16 y el decodificador en 4 bits, la misma combinación que la demo oficial de Hugging Face.

### Cómo se adapta a cada equipo

Al abrir el diálogo de transcripción, la app identifica el equipo:

- **Tipo:** teléfono, tablet o computadora. El iPad se reconoce aunque Safari se identifique como Mac.
- **Memoria:** solo si el navegador la informa (Chrome y Edge).
- **GPU:** si hay WebGPU real (se descarta el adaptador por software) y si admite fp16.
- **Espacio:** cuánto espacio libre le queda al sitio.

Con eso decide:

| | Teléfono | Tablet (iPad incluido) | Computadora |
| --- | --- | --- | --- |
| Recomendado | Base (Tiny si tiene ≤ 2 GB) | Small | Large v3 Turbo si hay GPU con fp16; si no, Small |
| GPU o CPU en Auto | Siempre CPU | Según la tabla de modelos | Según la tabla de modelos |
| Small | Disponible, con advertencia de memoria | Sí | Sí |
| Large v3 Turbo | Desactivado | Disponible, con advertencia de memoria | Sí (desactivado con < 4 GB) |

Además:
- **Descargas:** si una variante del modelo ya está descargada, Auto la usa antes que bajar otra.
- **Espacio:** si no parece haber espacio suficiente, el modelo muestra una advertencia.
- **Fallo de la GPU en Auto:** si la GPU falla al cargar un modelo, la app sigue sola con la CPU y lo recuerda en ese navegador. Pulsar Auto o GPU en Ajustes la vuelve a habilitar.

**Forzar el modo:** en **Ajustes → Transcripción → Procesar con** puedes elegir **Auto**, **GPU** o **CPU**. Si fuerzas GPU y el navegador no tiene WebGPU, se usa la CPU. Si fuerzas CPU, Large v3 Turbo queda desactivado.

**Whisper Medium no está incluido a propósito.** Se probó de las dos maneras:

- **En el procesador:** ONNX Runtime usa WASM de 32 bits, con 4 GB de memoria como máximo, y Medium se queda sin memoria a mitad de la transcripción.
- **En la tarjeta gráfica:** con el codificador en fp16 y el decodificador en 4 bits (1,09 GB), tardó 436 s en los mismos 56 s de voz y devolvió solo 29 de las 145 palabras, cortadas a mitad. Large v3 Turbo lo hace en 24 s y casi sin errores.

Large v3 completo tampoco está: pesa el doble que Turbo y es mucho más lento, con una precisión casi igual.

### Biblioteca: cada audio con sus textos

La biblioteca se organiza por audio. Cada audio que cargas se guarda una sola vez y puede tener varios textos: su SRT, una transcripción por cada modelo de Whisper que pruebes, otra versión corregida… Cada texto recuerda el punto donde te quedaste.

- **Al cargar un audio** que ya usaste, la pantalla lista sus textos guardados para elegir cuál leer. Si no tiene ninguno, ofrece transcribirlo o elegir su SRT, y lo que hagas queda guardado junto al audio.
- **Al recargar la página** vuelve lo último que tenías: un texto con su audio, o un audio solo con su lista de textos.
- **En la biblioteca** pulsas un audio para cargarlo y ver sus textos, o un texto para abrirlo directamente. Si cambias a otro texto del mismo audio mientras suena, el audio sigue donde iba, sin pausas.
- **Cada texto se descarga como `.srt`** con el botón de la flecha: así sacas del navegador lo que escribió Whisper.
- **Borrar un audio** borra también todos sus textos. Borrar un texto deja el audio y sus otros textos.
- **Un audio se reconoce por su nombre y tamaño.** Si lo vuelves a elegir desde otra carpeta es el mismo; si lo renombras o lo vuelves a exportar, cuenta como otro.
- **Los textos cuyo audio no está guardado** (por falta de espacio, o de versiones anteriores de la app) aparecen al final, en «Textos sin audio guardado». Al elegirles un audio pasan a ese audio.

### Cómo se emparejan el audio y el texto

La app solo une un texto con un audio cuando no hay duda, para que nunca se mezcle el texto de un audio con otro.

| Haces esto | Pasa esto |
| --- | --- |
| Eliges un audio y después su SRT (o al revés) | El SRT queda guardado como un texto de ese audio |
| Eliges **otro audio** con un texto abierto que ya tiene el suyo | El texto se cierra (sigue en la biblioteca) y la pantalla lista los textos del audio nuevo, o pide uno si no tiene |
| Eliges un SRT que ya tiene su audio guardado | Se abre con **su** audio, aunque sonara otro |
| Eliges un SRT nuevo mientras está abierto un texto de otro audio | Se abre **sin** ese audio. El aviso ofrece «Elegir audio» o «Usar …», por si también era de ese audio |
| Arrastras un audio y un SRT **juntos** | Van juntos |
| Abres un texto de la biblioteca | Se abre con su audio guardado. Si no tiene, quita el que sonara de otro texto |
| Vuelves a elegir el mismo audio | Avisa de que ya está cargado y no cambia nada |
| Borras el texto abierto | El audio sigue cargado y la pantalla lista sus otros textos |

**Mientras se transcribe:**
- **Las líneas van apareciendo** y puedes escuchar el audio a la vez.
- **Si el audio adelanta a la transcripción,** la línea actual pasa a ser «Transcribiendo… lo que sigue a 0:24 aparecerá aquí», en vez de quedarse marcada la última línea transcrita. En cuanto llegan las líneas nuevas, el resaltado salta a la que corresponde.
- **Al terminar,** el audio sigue sonando donde iba, sin pausas ni saltos, y la transcripción se guarda como un texto más de ese audio, junto a los que ya tuviera.
- **Si cancelas, falla o cargas otra cosa,** vuelve el texto que había antes. Abrir un texto de la biblioteca también cancela la transcripción.

### Teclado

| Tecla | Acción |
| --- | --- |
| `Espacio` | Reproducir o pausar |
| `←` `→` | Saltar 5 segundos |
| `↑` `↓` | Línea anterior o siguiente |
| `+` `−` | Tamaño del texto |
| `M` / `F` | Modo espejo / pantalla completa |
| `B` | Abrir la biblioteca |

## Desarrollo

La página necesita un servidor: abierta como `file://`, el navegador bloquea el worker de transcripción y la caché de los modelos. Para desarrollar se usa [Vite](https://vite.dev) **solo como servidor de desarrollo**. No hay paso de compilación: GitHub Pages publica los archivos tal cual.

Requiere Node.js 20.19 o posterior.

```sh
npm install        # una vez
npm run dev        # http://localhost:5173, se recarga sola al guardar
npm test           # pruebas: SRT, emparejamiento, biblioteca, elección de modelo por equipo
```

Las pruebas usan el ejecutor que trae Node (`node --test`), sin dependencias. Cubren las partes sin interfaz, que son funciones puras: lo que se muestra en pantalla se prueba abriendo la app.

### Probar en el teléfono o el iPad

```sh
npm run dev:lan    # https://<IP-de-tu-computadora>:5173, visible en tu red local
```

Abre en el teléfono o el iPad la dirección *Network* que muestra la terminal; ambos equipos tienen que estar en la misma red Wi-Fi. Usa HTTPS porque WebGPU y la caché de modelos solo funcionan en un contexto seguro, y `http://192.168.…` no lo es. El certificado es autofirmado, así que el navegador mostrará un aviso la primera vez: acéptalo para continuar (en Safari: *Mostrar detalles → visitar este sitio web*).

### Por qué hay un plugin en `vite.config.js`

Vite reescribe los `.js` que sirve. En `js/transcribe/worker.js` cambiaría `import(runtime.lib)` por una función auxiliar y añadiría un `import` de su propio cliente, que el worker no puede cargar. El plugin sirve `js/` y `css/` (con sus subcarpetas) byte a byte, igual que GitHub Pages, y recarga la página cuando cambia cualquier archivo.

### Sin Node

Cualquier servidor estático sirve igual, aunque sin recarga automática:

```sh
python3 -m http.server 8000   # http://localhost:8000
```

## Publicar en GitHub Pages

1. Sube el repositorio a GitHub.
2. En **Settings → Pages**, en *Build and deployment*, elige **Deploy from a branch**, la rama `main` y la carpeta `/ (root)`.
3. En uno o dos minutos la app queda en `https://<tu-usuario>.github.io/<nombre-del-repo>/`.

Todas las rutas son relativas, así que funciona igual en un subdirectorio de proyecto que en un dominio propio. El archivo `.nojekyll` evita que GitHub procese el sitio con Jekyll.

## Estructura

El código son módulos de JavaScript (`import`/`export`) que el navegador carga directamente, sin compilar. `index.html` carga `js/main.js` y este importa el resto.

```
index.html                Marcado de la app
favicon.svg
css/
  base.css                Colores (claro y oscuro), botones y piezas comunes
  shell.css               Cabecera, aviso y controles de reproducción
  prompter.css            Las líneas, la flecha de lectura y la pantalla vacía
  settings.css            Panel de Ajustes
  transcribe.css          Ventana de transcripción
  library.css             Biblioteca
js/
  main.js                 Arranque: conecta los módulos y reabre lo último
  state.js                Lo que está en pantalla, compartido entre módulos
  ui.js                   $, el(), avisos (toast)
  format.js               Formatos de tiempo y tamaño, hash          (puro)
  srt.js                  Leer y escribir SRT/VTT                      (puro)
  pairing.js              Reglas de qué texto va con qué audio         (puro)
  player.js               El reloj: archivo de audio o simulado
  prompter.js             Líneas, resaltado palabra a palabra, barra de tiempo
  screen.js               El aviso y la pantalla vacía (lista de textos de un audio)
  session.js              El texto abierto: abrir, cerrar, su audio, posición
  files.js                Elegir o arrastrar archivos
  settings.js             Ajustes guardados y su panel
  controls.js             Botones, teclado y pantalla completa
  library/
    data.js               Registros: clave de audio, nombres, agrupar  (puro)
    texts.js              Textos y datos de audios en localStorage
    audios.js             Archivos de audio en IndexedDB y migración
    panel.js              Panel de la biblioteca
  transcribe/
    models.js             Modelos Whisper y versión de transformers.js (puro)
    device.js             Detectar el equipo y elegir GPU/CPU         (puro)
    audio.js              Preparar el audio: 16 kHz y tramos de 30 s
    lines.js              Convertir la salida de Whisper en líneas    (puro)
    dialog.js             Ventana «Transcribir con Whisper»
    run.js                La transcripción en curso y guardar el resultado
    worker.js             Web Worker (módulo) que ejecuta Whisper
tests/                    npm test: una prueba por cada módulo puro
package.json              Solo para desarrollo: Vite, npm run dev / dev:lan / test
vite.config.js            Configuración del servidor de desarrollo
```

Los módulos marcados como *puros* no tocan la página ni el navegador, y por eso las pruebas los cargan en Node.

### Dónde va cada cosa nueva

- **Una regla nueva** (cuándo emparejar, cómo agrupar, cómo cortar líneas): en un módulo puro, con su prueba en `tests/`.
- **Una pantalla o un panel nuevo:** su propio módulo, con una función `initX()` que conecta los botones y que se llama desde `main.js`, y su propio archivo en `css/`.
- **Algo que deben ver varios módulos:** en `state.js` si es lo que está en pantalla. Si no, se queda dentro de su módulo y se expone con funciones.
- **Al arrancar, los módulos solo definen cosas;** todo lo que usa otro módulo ocurre dentro de funciones. Así los módulos que se importan entre sí funcionan sin importar el orden en que se cargan.

## Dónde se guardan los datos

Todo queda en el navegador de quien usa la app. No hay servidor propio ni cuentas.

| Qué | Dónde |
| --- | --- |
| Ajustes, lista de audios y textos, líneas de cada texto y posición | `localStorage` |
| Archivos de audio de la biblioteca (uno por audio, aunque tenga varios textos) | IndexedDB (base `apuntador`) |
| Modelos Whisper y runtime WASM | Cache Storage (`transformers-cache` y `apuntador-runtime`) |

Los textos ocupan poco: `localStorage` admite unos 5 MB por sitio, suficiente para decenas de horas de transcripción. Los audios van aparte, en IndexedDB, que usa el espacio libre del disco. Si un audio no cabe, la app avisa y su texto se guarda igual.

Los modelos se descargan **una sola vez**. Desde el diálogo de transcripción puedes borrar cada modelo para liberar espacio.

## Dependencias externas

La app no incluye binarios en el repositorio. Los carga desde estos servicios:

- **[transformers.js](https://github.com/huggingface/transformers.js) 3.8.1** y su runtime ONNX en WASM, desde jsDelivr (versión fija en `js/transcribe/models.js`, constante `TJS_VERSION`).
- **Modelos** desde Hugging Face: [`whisper-tiny_timestamped`](https://huggingface.co/onnx-community/whisper-tiny_timestamped), [`whisper-base_timestamped`](https://huggingface.co/onnx-community/whisper-base_timestamped), [`whisper-small_timestamped`](https://huggingface.co/onnx-community/whisper-small_timestamped) y [`whisper-large-v3-turbo_timestamped`](https://huggingface.co/onnx-community/whisper-large-v3-turbo_timestamped), de onnx-community.
- **Fuentes** Atkinson Hyperlegible e IBM Plex Mono, desde Google Fonts.

Si cambias de versión de transformers.js, actualiza también `RUNTIME.wasmSize` en `js/transcribe/models.js`. Ese tamaño solo se usa para la barra de progreso.

Para añadir otro modelo, agrégalo a `MODELS` en `js/transcribe/models.js` y su texto a `MODEL_INFO`. `npm test` comprueba que los tamaños cuadren y prueba la elección de modelo en distintos equipos. Cada modelo necesita:
- sus archivos comunes y una o más variantes (CPU o GPU), con la lista exacta de archivos y su tamaño en bytes;
- `auto`, el dispositivo que prefiere Auto;
- y, si hace falta, `limits`, para desactivarlo o advertir en teléfonos y tablets, o exigir una memoria mínima.

Los nombres `.onnx` tienen que coincidir con el `dtype` de la variante: `q8` usa `*_quantized.onnx`, `fp32` no lleva sufijo, `fp16` usa `*_fp16.onnx` y `q4` usa `*_q4.onnx`.

GitHub Pages no envía las cabeceras COOP/COEP, así que ONNX Runtime funciona con un solo hilo en el procesador (`numThreads = 1`). Los modelos que corren en el procesador sirven igual, aunque más lentos que con varios hilos. A Large v3 Turbo no le afecta, porque corre en la tarjeta gráfica.
