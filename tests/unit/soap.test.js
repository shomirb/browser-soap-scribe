import assert from 'node:assert/strict';
import test from 'node:test';
import { samples } from '../../src/samples.js';
import { classifyRequest } from '../../src/privacy.js';
import {
  applySupport,
  buildSectionMessages,
  heuristicLines,
  parseLinePicks,
  parseModelNote,
  parseSectionOutput,
  parseTranscript,
  quotesForLines,
  scanChecklist,
  summaryIsGrounded,
  supportLines,
  toMarkdown,
  toPlainText,
} from '../../src/soap.js';

const expected = {
  'syn-2201': { allergies: true, medications: true, vitals: true },
  'syn-2202': { allergies: false, medications: true, vitals: true },
  'syn-2203': { allergies: false, medications: false, vitals: false },
  'syn-2204': { allergies: true, medications: true, vitals: false },
  'syn-2205': { allergies: false, medications: false, vitals: true },
};

test('ships five labeled fictional samples', () => {
  assert.equal(samples.length, 5);
  for (const sample of samples) {
    assert.match(sample.text, /\[SYNTHETIC SAMPLE/i);
    assert.match(sample.text, /fictional visit, not a real patient/i);
    assert.equal(sample.text.includes('John Smith'), false);
  }
});

test('checklist flags match each sample on purpose', () => {
  for (const sample of samples) {
    const flags = Object.fromEntries(
      scanChecklist(parseTranscript(sample.text)).map((flag) => [flag.id, flag.present]),
    );
    assert.deepEqual(flags, expected[sample.id], sample.id);
  }
});

test('parser keeps citations and ignores instruction-like preamble', () => {
  const raw = `Sure, here is the note.
## Subjective
- Burning throat since Monday [2, 3]
## Objective
- Temperature 100.4 F and a red throat [8]
## Assessment
- Viral sore throat, as the clinician described [10]
## Plan
- Rest, fluids, and return precautions [10]
## Patient summary
Rest and drink fluids. Come back if swallowing liquids gets hard.`;
  const note = parseModelNote(raw);
  assert.equal(note.structured, true);
  assert.equal(note.subjective[0].text, 'Burning throat since Monday');
  assert.deepEqual(note.subjective[0].cites, [2, 3]);
  assert.match(note.summary, /Rest and drink fluids/);
  assert.equal(note.objective.length, 1);
});

test('support lines prefer the transcript over a vague sentence', () => {
  const sample = samples[0];
  const lines = parseTranscript(sample.text);
  const cites = supportLines('Penicillin gives me a rash', [], lines);
  assert.ok(cites.length >= 1);
  const cited = lines.find((line) => line.n === cites[0]);
  assert.match(cited.raw, /Penicillin/);
});

test('not-documented statements do not invent citations', () => {
  const lines = parseTranscript(samples[2].text);
  assert.deepEqual(supportLines('Not documented in the transcript.', [4], lines), []);
});

test('markdown export carries the disclaimer and checklist', () => {
  const sample = samples[2];
  const lines = parseTranscript(sample.text);
  const parsed = applySupport(
    parseModelNote(`## Subjective
- Rolled the right ankle yesterday [2]
## Objective
- Swollen lateral ankle [5]
## Assessment
- Ankle sprain pattern described by the clinician [5]
## Plan
- Brace, ice, and follow up if walking gets worse [7]
## Patient summary
You rolled your ankle. Use a brace and ice, and come back if walking gets worse.`),
    lines,
  );
  const markdown = toMarkdown(parsed, {
    modelId: 'test-model',
    runtime: 'wasm',
    edited: false,
    flags: scanChecklist(lines),
  });
  assert.match(markdown, /Not medical advice and not for clinical use/);
  assert.match(markdown, /## Subjective/);
  assert.match(markdown, /## Plan/);
  assert.match(markdown, /Allergies: not found/);
  assert.match(markdown, /Medications: not found/);
  assert.match(markdown, /Vitals: not found/);
  const plain = toPlainText(parsed, {
    modelId: 'test-model',
    runtime: 'wasm',
    edited: true,
    flags: scanChecklist(lines),
  });
  assert.equal(plain.includes('## '), false);
  assert.match(plain, /Edited in the browser/);
});

test('section prompt asks for line numbers only', () => {
  const messages = buildSectionMessages(parseTranscript(samples[4].text), 'subjective');
  assert.match(messages[0].content, /line numbers/);
  assert.match(messages[1].content, /headaches/);
  assert.match(messages[1].content, /Line numbers:/);
  assert.equal(messages[1].content.includes('[SYNTHETIC SAMPLE'), false);
});

test('line picks accept a short number list and reject prose or code', () => {
  const lines = parseTranscript(samples[0].text);
  assert.deepEqual(parseLinePicks('3, 5, 7', lines), [3, 5, 7]);
  assert.deepEqual(parseLinePicks('function extractSymptoms() { return 3; }', lines), []);
  assert.equal(summaryIsGrounded('Temperature was 118 F.', ['temperature 100.4']), false);
});

test('keyword backup quotes the sore throat in the patient’s words', () => {
  const lines = parseTranscript(samples[0].text);
  const quotes = quotesForLines(heuristicLines('subjective', lines), lines);
  assert.match(quotes.map((quote) => quote.text).join('\n'), /throat/i);
  assert.ok(quotes.every((quote) => quote.cites.length === 1));
});

test('section parser reads bullets and stops at not-documented', () => {
  const items = parseSectionOutput(`Assistant: ignored header
- Burning throat since Monday [3]
- Dry cough [5]
- Not documented in the transcript.
`);
  assert.equal(items.length, 2);
  assert.equal(items[0].text, 'Burning throat since Monday');
  assert.deepEqual(items[0].cites, [3]);
});

test('network classifier blocks transcript text and allows model hosts', () => {
  const canaries = ['Penicillin gives me a rash. I do not know'];
  assert.equal(classifyRequest('https://huggingface.co/onnx-community/model.onnx', '', canaries).phase, 'model');
  assert.equal(
    classifyRequest('https://example.com/upload', 'Penicillin gives me a rash. I do not know of any', canaries).phase,
    'blocked',
  );
  assert.equal(classifyRequest('https://example.com/analytics', '', canaries).phase, 'unexpected');
  assert.equal(classifyRequest('/src/main.js', '', canaries).phase, 'app');
});
