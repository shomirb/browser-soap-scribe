# HackerSquad submission draft

Event: HackerSquad AI Remote Hackathon (building period started November 6, 2026, 9:30 PM PT; deadline November 15, 2026, 11:59 PM PT).

Submit in the HackerSquad Builder Portal, not by sharing this file. The demo video has to be recorded inside HackerSquad and can be at most 3 minutes. A YouTube, Loom, Vimeo, or Drive link does not replace that recording.

Replace the commit SHA below with `git rev-parse HEAD` on `main` at the moment you submit. The deadline snapshot is the entry.

## Fields

**Project name:** Browser SOAP Scribe

**One-line description:** A SOAP note draft that a small language model writes entirely in the browser, from a fictional or pasted visit, without uploading the transcript.

**Team:** Solo. Shomir Banerjee.

**Problem and users:** Clinicians spend the end of a visit turning a conversation into a Subjective, Objective, Assessment, and Plan note. Cloud scribes do that by sending the transcript off the device. The intended user is a clinician who wants an editable first draft, a pointer back to the lines that support each sentence, and a visible flag when allergies, medicines, or vitals were never said. This build is a labeled prototype for that workflow. It is not for real patients and not medical advice.

**How AI is used:** A small instruct model runs in the page. The recommended path is WebGPU via WebLLM with Qwen2.5-1.5B-Instruct (about 1 GB); Qwen2.5-0.5B and Llama-3.2-1B are selectable. That path drafts each SOAP section from the full transcript and retries once if the reply has no grounded bullet. If WebGPU is missing, transformers.js runs Qwen2.5-0.5B-Instruct as 8-bit ONNX on WASM (about 512 MB). The CPU model rewrites one line at a time, with a worked example and a 40-token cap. A sentence is kept only when it still matches that line; otherwise the note shows the transcript line and says so. A patient summary is kept only when it stays inside those sentences. No clinical API key is used.

**Tools used:** Vite, vanilla HTML/CSS/JS, `@mlc-ai/web-llm`, `@huggingface/transformers`, `coi-serviceworker` (so GitHub Pages can enable the cross-origin isolation WebLLM needs), Playwright, and Node’s test runner. Model weights download from Hugging Face at runtime. An AI coding assistant was used to write the project during the event. No sponsor API was required.

**Working app:** https://shomirb.github.io/browser-soap-scribe/

No environment variables. Local run: `npm ci` then `npm run dev`. Click **Try fictional sample**. The first run downloads the model (about 1 GB on WebGPU, about 512 MB on CPU).

**Public repository:** https://github.com/shomirb/browser-soap-scribe

**Commit SHA:** Use `git rev-parse HEAD` on `main` at submission time. The deadline snapshot is the entry.

**Prior-work disclosure:** None. All application code was written during this hackathon. There is no earlier submitted or awarded version. Third-party libraries and the Qwen and Llama weights are used under their own licenses and were not written for this event. Sample visits are fictional and labeled in the UI and in the files.

## Demo script (3:00)

Record this inside HackerSquad. Have the CPU model cached beforehand if you can, so the recording is not a download bar. If it is not cached, say so and show the progress once, then cut to the draft.

| Time | What to show | What to say |
| --- | --- | --- |
| 0:00–0:20 | Disclaimer, the on-device pill, and sample SYN-2201. | Clinicians close a visit by writing a SOAP note. Cloud tools send the transcript away. This draft stays in the browser. It is a prototype, not for real patients. |
| 0:20–0:50 | Checklist (allergies, medicines, vitals all mentioned). Switch to SYN-2203 and show three “missing” chips. Switch back. | Before any model runs, the page marks whether allergies, medicines, and vitals were actually said. |
| 0:50–1:40 | Point at the WebGPU recommendation and the download-size note. Click **Try fictional sample**. Show progress, then the SOAP sentences and a line chip. | WebGPU with Qwen2.5 1.5B is the path to use when a GPU is available. This browser is on CPU, so Qwen2.5 0.5B rewrites one line at a time. If a sentence is not in that line, the note keeps the transcript quote and says so. |
| 1:40–2:05 | Edit one subjective line. Read the patient summary. | The clinician can rewrite every section. The summary is kept only when it stays inside those sentences. |
| 2:05–2:20 | Download Markdown or copy. Flash the “not for clinical use” line in the file. | Export is Markdown, plain text, or a copy. The disclaimer travels with the note. |
| 2:20–2:45 | Open the privacy panel. Point at Hugging Face weight URLs and “Blocked or unexpected: 0”. Mention DevTools on a second draft. | The model runs in a worker via WebLLM or transformers.js. Weights download once. The visit is not a request body. I wrote this during the hackathon; the models and libraries are third-party. |
| 2:45–3:00 | Stamp, disclaimer, and the runtime note. | It is a prototype. The 0.5B CPU model often has to fall back to the transcript line. Dictation in Chrome can leave the device. None of this is for clinical use. |

## Screenshot set in the repo

- `docs/screenshots/ready-to-draft.png` — fictional sample loaded, model not yet downloaded
- `docs/screenshots/missing-flags.png` — a visit with allergies, medicines, and vitals all absent
- `docs/screenshots/soap-draft.png` — WASM draft with quotes, citations, and the patient summary
- `docs/screenshots/privacy-log.png` — weight downloads only, no blocked clinical request
