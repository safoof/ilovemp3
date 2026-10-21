# iLoveMP3

Free online tools for working with MP3 files. Everything runs in the browser, so files are never uploaded anywhere.

## Tools

| Tool | What it does |
| --- | --- |
| **Trim MP3** | Keep or remove a selected part, with optional fade in/out. Tags and cover art are kept. |
| **Merge MP3** | Join several audio files into one MP3, in any order, with optional silence between tracks. |
| **Convert to MP3** | Convert WAV, M4A, FLAC, OGG, AAC and video files to MP3, or MP3 to WAV. Batch download as ZIP. |
| **Compress MP3** | Re-encode at a lower bitrate (down to 48 kbps mono for speech). Keeps tags and cover art. |
| **Edit MP3 Tags** | Edit title, artist, album, year, track, genre, comment and cover art without re-encoding. |

## How it works

- Audio is decoded with the Web Audio API (`decodeAudioData`), so any format the browser can play can be used as input.
- MP3 encoding uses [LAME](https://lame.sourceforge.io/) compiled to JavaScript ([lamejs](https://github.com/zhuker/lamejs)), running in a Web Worker so the page stays responsive. Audio is streamed to the worker in chunks, so long merges don't need to hold everything in memory at once.
- ID3 tags are read from ID3v1 and ID3v2.2–2.4 and written as ID3v2.3 for maximum compatibility.
- No build step, no framework, no server: just static files.

## Project structure

```
index.html              Home page with the tool grid
<tool>/index.html       One folder per tool (pretty URLs on GitHub Pages)
assets/css/style.css    All styles (light and dark themes)
assets/js/
  pages/                Page logic for each tool
  audio.js              Decoding, editing, MP3/WAV encoding, playback
  mp3-worker.js         LAME encoder worker
  id3.js                ID3 tag reader/writer
  waveform.js           Waveform with draggable selection
  ui.js                 Shared UI helpers (stages, file picker, file lists)
  batch.js              Shared flow for multi-file tools
  zip.js                Minimal ZIP writer
  tools.js              Tool registry (used by the nav and home page)
assets/vendor/          Third-party code (lamejs)
```

## Adding a tool

1. Add an entry to `assets/js/tools.js`. It shows up in the header and on the home page automatically.
2. Copy an existing tool folder (e.g. `compress-mp3/`) and adjust the HTML.
3. Add the page script in `assets/js/pages/`.

## Running locally

ES modules and workers don't load over `file://`, so use any static server:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Deploying to GitHub Pages

Push to GitHub, then go to **Settings → Pages** and choose **Deploy from a branch**, branch `main`, folder `/ (root)`. All paths are relative, so the site works at `https://<user>.github.io/ilovemp3/` or on a custom domain.

## License

MIT, see [LICENSE](LICENSE). The bundled LAME encoder (`assets/vendor/lamejs.js`) is LGPL-3.0; see [assets/vendor/README.md](assets/vendor/README.md).
