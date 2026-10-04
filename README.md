# StemForge AI

A browser audio studio: drop in a track, watch it render live, and preview it with the
vocal, bass, drums or instrumental brought forward. Everything runs client-side through
the Web Audio API.

**[Live demo](https://amir-pce.github.io/ChangeQuality-Music/)** · [Persian documentation](README.fa.md)

## What this is, and what it is not

Real stem separation — pulling a clean vocal out of a finished mix — needs a trained
model such as Demucs or Spleeter, running either on a server or as a heavy WebAssembly
build. **This does not do that, and does not claim to.**

What it does is route the audio graph through `BiquadFilter` nodes to emphasise the
frequency bands each part lives in. The result is a usable preview and an approximate
export, produced instantly and with no upload. The front end is built to have a real
separation API dropped in behind it, and the page documents where that call would go.

Saying this plainly in the README is deliberate. A demo that implies a model it does not
have is the kind of thing that gets found out in the first technical conversation.

## Features

- Upload by click or drag and drop; file name, size, format and duration read back
- Custom transport — play, pause, seek, volume
- **Live visualiser** on `<canvas>`, driven by the Web Audio analyser node
- Five preview modes: original mix, vocal focus, bass line, drums and percussion,
  instrumental focus
- **Client-side WAV export** of whichever mode is selected
- Processing state and progress meter
- Toast messaging for guidance and errors

## No upload, no storage

There is no database and no backend. The file is read in the browser with
`URL.createObjectURL(file)` and never leaves the machine — which, for anyone handling
unreleased audio, is the interesting property.

## Built with

HTML · CSS · JavaScript · jQuery · Bootstrap RTL · Web Audio API · Canvas · Font Awesome

```
index.html
css/style.css
js/app.js
```

Static. Open `index.html`.
