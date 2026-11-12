import { createEngine, detectWebGPU } from './engine.js';
import { DEFAULT_WEBGPU_ID, WASM_MODEL, WEBGPU_MODELS, modelById } from './models.js';
import { installNetworkGuard, clearWeightCaches } from './privacy.js';
import { sampleById, samples } from './samples.js';
import {
  SECTIONS,
  applySupport,
  buildLineMessage,
  buildRetryMessages,
  buildSectionMessages,
  bulletIsGrounded,
  firstDraftSentence,
  buildSummaryMessages,
  canariesFromTranscript,
  cleanProse,
  draftItemsFromModel,
  fallbackSummary,
  heuristicLines,
  nextStatementId,
  parseTranscript,
  quotesForLines,
  scanChecklist,
  summaryIsGrounded,
  toMarkdown,
  toPlainText,
} from './soap.js';

const $ = (id) => document.getElementById(id);

const els = {
  sample: $('sample-select'),
  blurb: $('sample-blurb'),
  transcript: $('transcript'),
  lines: $('line-list'),
  dictate: $('dictate'),
  interim: $('interim'),
  runtime: $('runtime-select'),
  model: $('model-select'),
  hint: $('model-hint'),
  progress: $('progress'),
  bar: $('progress-bar'),
  status: $('model-status'),
  error: $('model-error'),
  trySample: $('try-sample'),
  draft: $('draft-button'),
  stop: $('stop-button'),
  useCpu: $('use-cpu'),
  runtimeNote: $('runtime-note'),
  downloadNotice: $('download-notice'),
  errorText: $('model-error-text'),
  errorDetail: $('model-error-detail'),
  clearCache: $('clear-cache'),
  flags: $('missing-flags'),
  picker: $('picker-note'),
  note: $('note'),
  empty: $('note-empty'),
  body: $('note-body'),
  exportMd: $('export-md'),
  exportTxt: $('export-txt'),
  copy: $('copy-note'),
  copyStatus: $('copy-status'),
  raw: $('raw-output'),
  preview: $('markdown-preview'),
  pill: $('privacy-pill'),
  pillText: $('privacy-pill-text'),
  panel: $('privacy-panel'),
  close: $('privacy-close'),
  log: $('privacy-log'),
  clearLog: $('clear-log'),
  draftRequests: $('draft-requests'),
  speech: $('speech-dialog'),
};

const params = new URLSearchParams(location.search);
const state = {
  lines: [],
  flags: [],
  note: null,
  edited: false,
  raw: '',
  stream: '',
  phaseLabel: 'Drafting on this device',
  picker: '',
  runtime: 'wasm',
  modelId: WASM_MODEL.id,
  busy: false,
  webgpu: false,
  log: [],
  draftStartedAt: 0,
  requestsDuringDraft: 0,
  clinicalDuringDraft: 0,
  activeCites: [],
};

let canaries = [];
let recognition = null;
installNetworkGuard(window, recordNet, () => canaries);

const engine = createEngine({
  onProgress: showProgress,
  onToken: (message) => {
    state.stream += message.text || '';
    els.raw.textContent = `${state.raw}\n${state.stream}`.trim();
    const words = state.stream.trim() ? state.stream.trim().split(/\s+/).length : 0;
    els.status.textContent = `${state.phaseLabel} · ${words} words`;
  },
  onNet: recordNet,
  onWorkerError: (message) => showError(message),
});

function recordNet(entry) {
  if (!entry) return;
  state.log.push(entry);
  if (state.log.length > 300) state.log.shift();
  if (state.draftStartedAt && entry.at >= state.draftStartedAt) {
    state.requestsDuringDraft += 1;
    if (entry.phase === 'blocked' || entry.phase === 'unexpected') state.clinicalDuringDraft += 1;
  }
  renderLog();
  renderPrivacyPill();
}

function renderPrivacyPill() {
  const clinical = state.log.filter((entry) => entry.phase === 'blocked' || entry.phase === 'unexpected').length;
  els.pill.dataset.clinical = String(clinical);
  const alert = clinical > 0;
  els.pill.dataset.state = alert ? 'alert' : 'ok';
  els.pillText.textContent = alert
    ? 'Check the privacy log · a request looked off'
    : 'On-device · patient text stays here';
  els.draftRequests.textContent = `Requests during the latest draft: ${state.requestsDuringDraft}. Blocked or unexpected: ${state.clinicalDuringDraft}.`;
}

function renderLog() {
  els.log.replaceChildren();
  const rows = state.log.length
    ? state.log
    : [{ phase: 'app', kind: 'info', reason: 'No requests recorded since this script started.', url: '' }];
  for (const entry of rows.slice(-80)) {
    const item = document.createElement('li');
    item.className = entry.phase === 'blocked' ? 'net-blocked' : entry.phase === 'unexpected' ? 'net-unexpected' : '';
    item.textContent = `${entry.phase || 'info'} · ${entry.kind || 'fetch'} · ${entry.reason || ''} ${entry.url || ''}`.trim();
    els.log.append(item);
  }
}

function setBusy(busy) {
  state.busy = busy;
  const empty = !els.transcript.value.trim();
  els.draft.disabled = busy || empty;
  els.trySample.disabled = busy;
  els.stop.disabled = !busy;
  els.runtime.disabled = busy;
  els.model.disabled = busy || els.runtime.value === 'auto';
  els.clearCache.disabled = busy;
  els.useCpu.disabled = busy;
}

function mapError(message) {
  const detail = String(message || 'Unknown error');
  if (/failed to fetch|networkerror|network|load failed|net::/i.test(detail)) {
    return {
      text: 'The model download stopped before it finished. Check the connection and try again. The transcript was not uploaded.',
      detail,
      offerCpu: false,
    };
  }
  if (/out of memory|device lost|webgpu|no adapter|adapter/i.test(detail)) {
    return {
      text: 'WebGPU could not run this model on this device. Use the CPU model instead. The transcript stayed in this tab.',
      detail,
      offerCpu: true,
    };
  }
  if (/empty draft/i.test(detail)) {
    return {
      text: 'The model returned nothing usable. Try the fictional sample again. The CPU model is smaller and less reliable than the WebGPU model.',
      detail,
      offerCpu: state.runtime === 'webgpu',
    };
  }
  return {
    text: 'The draft did not finish. You can try again. The transcript stayed on this device.',
    detail,
    offerCpu: state.runtime === 'webgpu',
  };
}

function showError(message) {
  if (!message) {
    els.error.hidden = true;
    els.errorText.textContent = '';
    els.errorDetail.textContent = '';
    els.useCpu.hidden = true;
    return;
  }
  const mapped = mapError(message);
  els.error.hidden = false;
  els.errorText.textContent = mapped.text;
  els.errorDetail.textContent = mapped.detail;
  els.useCpu.hidden = !mapped.offerCpu;
}

function showProgress(message) {
  const progress = Number.isFinite(message.progress) ? Math.max(0, Math.min(1, message.progress)) : 0;
  els.progress.hidden = false;
  els.bar.style.width = `${Math.round(progress * 100)}%`;
  els.progress.setAttribute('role', 'progressbar');
  els.progress.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  els.progress.setAttribute('aria-valuemin', '0');
  els.progress.setAttribute('aria-valuemax', '100');
  const bytes =
    message.total > 0
      ? ` · ${formatBytes(message.loaded || 0)} / ${formatBytes(message.total)}`
      : '';
  els.status.textContent = `${message.text || 'Working'}${bytes}`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function selectedPlan() {
  const runtimeChoice = els.runtime.value;
  if (runtimeChoice === 'wasm') return { runtime: 'wasm', model: WASM_MODEL, allowFallback: false };
  if (runtimeChoice === 'webgpu') {
    const model = modelById(els.model.value) || WEBGPU_MODELS[0];
    return { runtime: 'webgpu', model, allowFallback: false };
  }
  if (state.webgpu) {
    const model = modelById(DEFAULT_WEBGPU_ID);
    return { runtime: 'webgpu', model, allowFallback: true };
  }
  return { runtime: 'wasm', model: WASM_MODEL, allowFallback: false };
}

function fillModelSelect() {
  const choice = els.runtime.value;
  const models = choice === 'wasm' ? [WASM_MODEL] : choice === 'webgpu' ? WEBGPU_MODELS : [];
  els.model.replaceChildren();
  if (choice === 'auto') {
    const option = document.createElement('option');
    option.value = state.webgpu ? DEFAULT_WEBGPU_ID : WASM_MODEL.id;
    option.textContent = state.webgpu
      ? `${WEBGPU_MODELS[0].label} · WebGPU`
      : `${WASM_MODEL.label} · CPU`;
    els.model.append(option);
    els.model.disabled = true;
    els.hint.textContent = state.webgpu
      ? 'Recommended. Automatic uses WebGPU (Qwen2.5 1.5B, about 1 GB). If that load fails, the draft continues on the CPU model.'
      : 'WebGPU is not available here. Automatic uses the CPU fallback (Qwen2.5 0.5B, about 512 MB). A desktop browser with WebGPU is the recommended path.';
    return;
  }
  for (const model of models) {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.label;
    els.model.append(option);
  }
  const requested = params.get('model');
  if (requested && [...els.model.options].some((option) => option.value === requested)) {
    els.model.value = requested;
  }
  els.model.disabled = state.busy;
  const current = modelById(els.model.value);
  els.hint.textContent = current?.hint || '';
}

function renderLines() {
  state.lines = parseTranscript(els.transcript.value);
  state.flags = scanChecklist(state.lines);
  canaries = canariesFromTranscript(els.transcript.value);
  engine.setCanaries(canaries);
  els.lines.replaceChildren();
  for (const line of state.lines) {
    const item = document.createElement('li');
    item.className = 'line';
    if (line.label) item.classList.add('label-line');
    item.dataset.n = String(line.n);
    if (state.activeCites.includes(line.n)) item.classList.add('cited');
    const number = document.createElement('b');
    number.textContent = String(line.n);
    const body = document.createElement('div');
    if (line.speaker) {
      const speaker = document.createElement('div');
      speaker.className = 'speaker';
      speaker.textContent = line.speaker;
      body.append(speaker);
    }
    body.append(document.createTextNode(line.text));
    item.append(number, body);
    els.lines.append(item);
  }
  renderFlags();
  const match = samples.find((sample) => sample.text.trim() === els.transcript.value.trim());
  if (els.sample.value !== (match?.id || '') && document.activeElement !== els.sample) {
    els.sample.value = match?.id || '';
  }
  els.blurb.textContent = match
    ? match.blurb
    : els.transcript.value.trim()
      ? 'Custom text. Treat it as sensitive even though this app does not upload it.'
      : 'Choose a fictional sample or paste a transcript.';
  els.draft.disabled = state.busy || !els.transcript.value.trim();
  if (state.note) renderExport();
}

function renderFlags() {
  els.flags.replaceChildren();
  for (const flag of state.flags) {
    const chip = document.createElement('span');
    chip.className = `flag ${flag.present ? 'present' : 'missing'}`;
    chip.textContent = flag.present
      ? `${flag.label} mentioned · line ${flag.lines.join(', ')}`
      : `${flag.label} missing`;
    els.flags.append(chip);
  }
}

function focusLine(n, cites) {
  state.activeCites = cites || [n];
  for (const line of els.lines.querySelectorAll('.line')) {
    const number = Number(line.dataset.n);
    line.classList.toggle('cited', state.activeCites.includes(number));
    line.classList.toggle('active', number === n);
  }
  els.lines.querySelector(`.line[data-n="${n}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function updateStatement(sectionId, id, text) {
  const items = state.note[sectionId];
  const item = items.find((entry) => entry.id === id);
  if (!item) return;
  item.text = text;
  state.edited = true;
  renderExport();
}

function renderNote() {
  const hasNote = Boolean(state.note);
  els.note.dataset.state = hasNote ? 'ready' : 'empty';
  els.empty.hidden = hasNote;
  els.body.hidden = !hasNote;
  els.body.replaceChildren();
  els.exportMd.disabled = !hasNote;
  els.exportTxt.disabled = !hasNote;
  els.copy.disabled = !hasNote;
  els.picker.textContent = hasNote ? pickerCopy(state.picker) : '';
  if (!hasNote) {
    renderExport();
    return;
  }
  for (const section of SECTIONS) {
    const wrap = document.createElement('section');
    wrap.className = 'section';
    wrap.id = `section-${section.id}`;
    const title = document.createElement('h3');
    const letter = document.createElement('span');
    letter.textContent = section.letter;
    title.append(letter, document.createTextNode(section.label));
    wrap.append(title);
    const items = state.note[section.id];
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'No statements in this section.';
      wrap.append(empty);
    }
    items.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'statement';
      const field = document.createElement('textarea');
      field.value = item.text;
      field.setAttribute('aria-label', `${section.label} statement ${index + 1}`);
      field.addEventListener('input', () => updateStatement(section.id, item.id, field.value));
      field.addEventListener('focus', () => focusLine(item.cites[0] || 0, item.cites));
      const side = document.createElement('div');
      side.className = 'cite-row';
      if (item.cites.length) {
        for (const n of item.cites) {
          const cite = document.createElement('button');
          cite.type = 'button';
          cite.className = 'cite';
          cite.textContent = `L${n}`;
          cite.title = `Show transcript line ${n}`;
          cite.addEventListener('click', () => focusLine(n, item.cites));
          side.append(cite);
        }
      } else {
        const none = document.createElement('span');
        none.className = 'hint';
        none.textContent = 'No line match';
        side.append(none);
      }
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'mini';
      remove.textContent = 'Remove';
      remove.addEventListener('click', () => {
        state.note[section.id] = state.note[section.id].filter((entry) => entry.id !== item.id);
        state.edited = true;
        renderNote();
      });
      side.append(remove);
      row.append(field, side);
      wrap.append(row);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'mini';
    add.textContent = 'Add statement';
    add.addEventListener('click', () => {
      state.note[section.id].push({ id: nextStatementId(), text: '', cites: [] });
      state.edited = true;
      renderNote();
    });
    wrap.append(add);
    els.body.append(wrap);
  }
  const summary = document.createElement('section');
  summary.className = 'section summary-box';
  summary.id = 'section-summary';
  const summaryTitle = document.createElement('h3');
  summaryTitle.textContent = 'Patient-friendly summary';
  const summaryField = document.createElement('textarea');
  summaryField.value = state.note.summary || '';
  summaryField.setAttribute('aria-label', 'Patient-friendly summary');
  summaryField.addEventListener('input', () => {
    state.note.summary = summaryField.value;
    state.edited = true;
    renderExport();
  });
  summary.append(summaryTitle, summaryField);
  els.body.append(summary);
  renderExport();
}

function pickerCopy(picker) {
  if (picker === 'model') {
    return 'Drafted on this device. Each sentence overlaps the cited transcript lines.';
  }
  if (picker === 'repaired') {
    return 'Some sentences were replaced with transcript quotes because they added facts that were not in the visit.';
  }
  if (picker === 'mixed') {
    return 'Some sections were drafted by the model. Others used keyword quotes because the model reply was not usable.';
  }
  if (picker === 'keywords') {
    return 'The model did not return a usable section, so these quotes were chosen by keyword rules.';
  }
  return '';
}

function sectionSource(parsed) {
  if (!parsed.items.length) return 'keywords';
  if (parsed.fromModel > 0 && parsed.replaced === 0) return 'model';
  if (parsed.fromModel > 0) return 'repaired';
  return 'keywords';
}

function combineSources(sources) {
  if (sources.every((source) => source === 'model')) return 'model';
  if (sources.every((source) => source === 'keywords')) return 'keywords';
  if (sources.every((source) => source === 'repaired' || source === 'model') && sources.includes('repaired')) {
    return 'repaired';
  }
  return 'mixed';
}

function noteMeta() {
  return {
    modelId: state.modelId,
    runtime: state.runtime,
    edited: state.edited,
    flags: state.flags,
    picker: state.picker,
  };
}

function renderExport() {
  if (!state.note) {
    els.preview.textContent = '';
    return;
  }
  els.preview.textContent = toMarkdown(state.note, noteMeta());
}

function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

async function runModel(plan, messages, allowFallback, maxTokens) {
  state.stream = '';
  const result = await engine.draft({
    runtime: state.modelId && state.runtime && plan.warm ? state.runtime : plan.runtime,
    modelId: plan.warm ? state.modelId : plan.model.id,
    dtype: plan.warm ? (state.runtime === 'wasm' ? WASM_MODEL.dtype : '') : plan.model.dtype,
    allowFallback: allowFallback && !plan.warm,
    messages,
    maxTokens,
    canaries,
  });
  state.runtime = result.runtime;
  state.modelId = result.modelId;
  plan.warm = true;
  const text = (result.text || state.stream || '').trim();
  state.raw = `${state.raw}\n\n${text}`.trim();
  state.stream = '';
  els.raw.textContent = state.raw;
  return { ...result, text };
}

async function draft() {
  const transcript = els.transcript.value.trim();
  if (!transcript || state.busy) return;
  const plan = { ...selectedPlan(), warm: false };
  setBusy(true);
  showError('');
  state.raw = '';
  state.stream = '';
  state.note = null;
  renderNote();
  els.raw.textContent = 'Drafting…';
  state.draftStartedAt = Date.now();
  state.requestsDuringDraft = 0;
  state.clinicalDuringDraft = 0;
  renderPrivacyPill();
  state.phaseLabel = 'Loading the on-device model';
  els.status.textContent = 'Starting the on-device model…';
  const collected = { subjective: [], objective: [], assessment: [], plan: [], summary: '' };
  const sources = [];
  let stopped = false;
  try {
    for (const section of SECTIONS) {
      const focused = (plan.warm ? state.runtime : plan.runtime) === 'wasm';
      const picks = heuristicLines(section.id, state.lines);
      if (focused) {
        if (!picks.length) {
          collected[section.id] = [{ id: nextStatementId(), text: 'Not documented in the transcript.', cites: [] }];
          sources.push('keywords');
          continue;
        }
        const items = [];
        let fromModel = 0;
        let replaced = 0;
        for (const n of picks) {
          const line = state.lines.find((candidate) => candidate.n === n);
          state.phaseLabel = `Drafting ${section.label} from line ${n}`;
          els.status.textContent = state.phaseLabel;
          const result = await runModel(
            plan,
            buildLineMessage(line, section.label),
            plan.allowFallback,
            40,
          );
          stopped = stopped || Boolean(result.stopped);
          const sentence = firstDraftSentence(result.text);
          if (bulletIsGrounded(sentence, line.text)) {
            items.push({ id: nextStatementId(), text: sentence, cites: [n] });
            fromModel += 1;
          } else {
            const quote = quotesForLines([n], state.lines, section.id)[0];
            if (quote) items.push(quote);
            replaced += 1;
          }
          if (stopped) break;
        }
        collected[section.id] = items;
        sources.push(sectionSource({ items, fromModel, replaced }));
        if (stopped) break;
        continue;
      }
      state.phaseLabel = `Drafting ${section.label} on this device`;
      els.status.textContent = state.phaseLabel;
      let result = await runModel(
        plan,
        buildSectionMessages(state.lines, section.id, { focused: false }),
        plan.allowFallback,
        Math.min(180, sectionTokenLimit()),
      );
      stopped = stopped || Boolean(result.stopped);
      let parsed = draftItemsFromModel(result.text, state.lines);
      if (!parsed.fromModel && !stopped) {
        state.phaseLabel = `Retrying ${section.label} on this device`;
        els.status.textContent = state.phaseLabel;
        result = await runModel(
          plan,
          buildRetryMessages(state.lines, section.id, { focused: false }),
          false,
          Math.min(140, sectionTokenLimit()),
        );
        stopped = stopped || Boolean(result.stopped);
        const retried = draftItemsFromModel(result.text, state.lines);
        if (retried.fromModel || !parsed.items.length) parsed = retried;
      }
      if (!parsed.items.length) {
        collected[section.id] = quotesForLines(picks, state.lines, section.id);
        sources.push(picks.length ? 'keywords' : 'keywords');
      } else {
        collected[section.id] = parsed.items;
        sources.push(sectionSource(parsed));
      }
      if (stopped) break;
    }
    const quotes = SECTIONS.flatMap((section) => collected[section.id].map((item) => item.text));
    if (!stopped) {
      state.phaseLabel = 'Drafting the patient summary on this device';
      els.status.textContent = state.phaseLabel;
      const result = await runModel(plan, buildSummaryMessages(quotes), false, Math.min(120, sectionTokenLimit()));
      stopped = stopped || Boolean(result.stopped);
      const prose = cleanProse(result.text);
      collected.summary = summaryIsGrounded(prose, quotes) ? prose : fallbackSummary(collected);
    } else {
      collected.summary = fallbackSummary(collected);
    }
    state.picker = combineSources(sources);
    const filled = SECTIONS.some((section) => collected[section.id].length) || collected.summary;
    if (!filled) throw new Error('The model returned an empty draft. Try again.');
    state.note = applySupport(collected, state.lines);
    state.edited = false;
    renderNote();
    const where = state.runtime === 'webgpu' ? 'WebGPU' : 'CPU / WASM';
    els.downloadNotice.textContent =
      'The model weights are cached in this browser. Another draft is designed not to download them again.';
    const cpuNote = state.runtime === 'wasm' ? ' CPU / WASM is the fallback. WebGPU with Qwen2.5 1.5B is the recommended path when a GPU is available.' : '';
    els.status.textContent = stopped
      ? `Stopped. Partial draft is editable. Model: ${state.modelId}`
      : `Draft ready · ${where} · ${state.modelId}. Weights stay cached in this browser.${cpuNote}`;
    els.progress.hidden = false;
    els.bar.style.width = '100%';
  } catch (error) {
    showError(error.message || String(error));
    els.status.textContent = 'The draft did not finish.';
    if (SECTIONS.some((section) => collected[section.id].length) || collected.summary) {
      state.note = applySupport(collected, state.lines);
      state.edited = false;
      renderNote();
    }
  } finally {
    setBusy(false);
    renderPrivacyPill();
  }
}

function sectionTokenLimit() {
  const requested = Number(params.get('maxTokens'));
  if (Number.isFinite(requested)) return Math.max(48, Math.min(220, requested));
  return 160;
}

function loadSample(id) {
  const sample = sampleById(id);
  if (!sample) return;
  els.transcript.value = sample.text;
  els.sample.value = id;
  renderLines();
}

function startDictation() {
  if (recognition) {
    recognition.stop();
    return;
  }
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) {
    showError('This browser does not expose the Web Speech API.');
    return;
  }
  els.speech.showModal();
}

function armDictation() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new Speech();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.onresult = (event) => {
    let interim = '';
    let finalText = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const piece = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += piece;
      else interim += piece;
    }
    if (finalText) {
      const prefix = els.transcript.value && !els.transcript.value.endsWith('\n') ? '\n' : '';
      els.transcript.value += `${prefix}${finalText.trim()}`;
      renderLines();
    }
    els.interim.textContent = interim ? `Hearing: ${interim}` : '';
  };
  recognition.onerror = () => {
    els.interim.textContent = '';
  };
  recognition.onend = () => {
    recognition = null;
    els.interim.textContent = '';
    els.dictate.textContent = 'Dictate';
  };
  els.dictate.textContent = 'Stop dictation';
  recognition.start();
}

function fillSamples() {
  for (const sample of samples) {
    const option = document.createElement('option');
    option.value = sample.id;
    option.textContent = sample.title;
    els.sample.append(option);
  }
}

els.sample.addEventListener('change', () => {
  if (!els.sample.value) {
    els.blurb.textContent = 'Custom text. Treat it as sensitive even though this app does not upload it.';
    return;
  }
  loadSample(els.sample.value);
});
els.transcript.addEventListener('input', renderLines);
els.runtime.addEventListener('change', fillModelSelect);
els.model.addEventListener('change', () => {
  const current = modelById(els.model.value);
  els.hint.textContent = current?.hint || '';
});
els.trySample.addEventListener('click', () => {
  loadSample('syn-2201');
  void draft();
});
els.draft.addEventListener('click', () => void draft());
els.useCpu.addEventListener('click', () => {
  els.runtime.value = 'wasm';
  fillModelSelect();
  showError('');
  void draft();
});
els.stop.addEventListener('click', () => engine.interrupt());
els.clearCache.addEventListener('click', async () => {
  setBusy(true);
  try {
    const plan = selectedPlan();
    await engine.clear({ runtime: plan.runtime, modelId: plan.model.id });
    await clearWeightCaches();
    els.status.textContent = 'Cached weights were removed. The next draft downloads the model again.';
  } catch (error) {
    showError(error.message || String(error));
  } finally {
    setBusy(false);
  }
});
els.exportMd.addEventListener('click', () => {
  if (!state.note) return;
  download('soap-note.md', toMarkdown(state.note, noteMeta()), 'text/markdown');
});
els.exportTxt.addEventListener('click', () => {
  if (!state.note) return;
  download('soap-note.txt', toPlainText(state.note, noteMeta()), 'text/plain');
});
els.copy.addEventListener('click', async () => {
  if (!state.note) return;
  const text = toMarkdown(state.note, noteMeta());
  try {
    await navigator.clipboard.writeText(text);
    els.copyStatus.textContent = 'Copied.';
  } catch {
    els.copyStatus.textContent = 'Clipboard was blocked. Use Download Markdown.';
  }
});
els.pill.addEventListener('click', () => {
  const open = els.panel.hidden;
  els.panel.hidden = !open;
  els.pill.setAttribute('aria-pressed', String(open));
});
els.close.addEventListener('click', () => {
  els.panel.hidden = true;
  els.pill.setAttribute('aria-pressed', 'false');
});
els.clearLog.addEventListener('click', () => {
  state.log = [];
  renderLog();
  renderPrivacyPill();
});
els.dictate.addEventListener('click', () => void startDictation());
els.speech.addEventListener('close', () => {
  if (els.speech.returnValue === 'start') armDictation();
});
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    void draft();
  }
});

fillSamples();
const runtimeParam = params.get('runtime');
if (runtimeParam === 'wasm' || runtimeParam === 'webgpu' || runtimeParam === 'auto') {
  els.runtime.value = runtimeParam;
}
state.webgpu = await detectWebGPU();
els.runtimeNote.textContent = state.webgpu
  ? 'Recommended path: WebGPU with Qwen2.5 1.5B. This browser has WebGPU, so Automatic uses it. CPU / WASM (Qwen2.5 0.5B, about 512 MB) is the fallback if the GPU load fails.'
  : 'Recommended path: WebGPU with Qwen2.5 1.5B in a desktop browser that has a GPU. This browser has no WebGPU, so Automatic uses the CPU / WASM fallback (Qwen2.5 0.5B, about 512 MB). The smaller model more often needs a retry or a quote fallback.';
fillModelSelect();
const sampleParam = params.get('sample');
loadSample(sampleById(sampleParam) ? sampleParam : 'syn-2201');
renderLog();
renderPrivacyPill();
renderNote();
if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) {
  els.dictate.disabled = true;
  els.dictate.title = 'This browser has no Web Speech API';
}
document.documentElement.dataset.webgpu = state.webgpu ? 'yes' : 'no';
$('app-ready').dataset.ready = 'yes';
