const STOP = new Set(
  `a an the and or of to for in on at by with from as is are was were be been being it this that these those i you we they he she his her their our your my me us not no do did does have has had but if so than then very just about into over after before also can will would should could there here today yesterday morning evening night last next still any some what how when who whom which your youre im ive dont doesnt didnt its`.split(
    /\s+/,
  ),
);

const SECTION_RULES = [
  { id: 'subjective', label: 'Subjective', name: 'subjective' },
  { id: 'objective', label: 'Objective', name: 'objective' },
  { id: 'assessment', label: 'Assessment', name: 'assessment' },
  { id: 'plan', label: 'Plan', name: 'plan' },
  { id: 'summary', label: 'Patient summary', name: 'patient(?:-friendly)?\\s+summary' },
];

export const SECTIONS = [
  { id: 'subjective', label: 'Subjective', letter: 'S' },
  { id: 'objective', label: 'Objective', letter: 'O' },
  { id: 'assessment', label: 'Assessment', letter: 'A' },
  { id: 'plan', label: 'Plan', letter: 'P' },
];

const CHECKS = [
  {
    id: 'allergies',
    label: 'Allergies',
    pattern: /\b(allerg(?:y|ies|ic)|nkda|no known drug allergies)\b/i,
  },
  {
    id: 'medications',
    label: 'Medications',
    pattern:
      /\b(medications?|medicines?|prescribed|ibuprofen|acetaminophen|paracetamol|lisinopril|metformin|aspirin|antibiotic|\d+(?:\.\d+)?\s?mg)\b/i,
  },
  {
    id: 'vitals',
    label: 'Vitals',
    pattern:
      /\b(blood pressure|heart rate|pulse|temperature|respiratory rate|oxygen saturation|spo2|o2 sat|vitals?)\b|\b\d{2,3}\s*\/\s*\d{2,3}\b/i,
  },
];

export function parseTranscript(raw) {
  const rows = [];
  let n = 0;
  for (const original of String(raw || '').replace(/\r\n/g, '\n').split('\n')) {
    const line = original.trim();
    if (!line) continue;
    n += 1;
    const label = /^\[synthetic sample\b/i.test(line);
    let speaker = '';
    let text = line;
    const match = line.match(/^(clinician|doctor|provider|patient|pt)\s*:\s*(.*)$/i);
    if (match) {
      speaker = /^p/i.test(match[1]) ? 'Patient' : 'Clinician';
      text = match[2];
    }
    rows.push({ n, speaker, text, raw: line, label });
  }
  return rows;
}

export function scanChecklist(lines) {
  return CHECKS.map((check) => {
    const hits = lines.filter((line) => !line.label && check.pattern.test(line.raw));
    return {
      id: check.id,
      label: check.label,
      present: hits.length > 0,
      lines: hits.map((hit) => hit.n),
    };
  });
}

export function canariesFromTranscript(raw) {
  return parseTranscript(raw)
    .filter((line) => !line.label && line.text.length >= 28)
    .map((line) => line.text.slice(0, 48));
}

function tokens(value) {
  return (String(value || '').toLowerCase().match(/[a-z0-9']+/g) || []).filter(
    (token) => token.length > 2 && !STOP.has(token),
  );
}

export function rankSupport(statement, lines) {
  const wanted = tokens(statement);
  const wantedSet = new Set(wanted);
  return lines
    .filter((line) => !line.label)
    .map((line) => {
      const seen = new Set();
      let hit = 0;
      for (const token of tokens(line.raw)) {
        if (wantedSet.has(token) && !seen.has(token)) {
          seen.add(token);
          hit += 1;
        }
      }
      const score = wanted.length ? hit / Math.sqrt(wanted.length) : 0;
      return { n: line.n, hit, score };
    })
    .sort((a, b) => b.score - a.score || b.hit - a.hit || a.n - b.n);
}

export function supportLines(statement, modelCites, lines) {
  const clean = String(statement || '').trim();
  if (!clean || /^not documented\b/i.test(clean)) return [];
  const usable = new Set(lines.filter((line) => !line.label).map((line) => line.n));
  const cited = [];
  for (const n of modelCites || []) {
    if (usable.has(n) && !cited.includes(n)) cited.push(n);
  }
  const lexical = rankSupport(clean, lines)
    .filter((row) => row.hit >= 2 || (row.hit >= 1 && row.score >= 0.9))
    .slice(0, 2)
    .map((row) => row.n);
  const merged = [];
  for (const n of [...cited, ...lexical]) {
    if (!merged.includes(n)) merged.push(n);
  }
  return merged.slice(0, 4);
}

function matchHeading(line) {
  const trimmed = line.trim();
  for (const rule of SECTION_RULES) {
    const markdown = trimmed.match(new RegExp(`^#{1,3}\\s+${rule.name}\\b\\s*:?\\s*(.*)$`, 'i'));
    if (markdown) return { id: rule.id, rest: markdown[1].trim() };
    const bold = trimmed.match(new RegExp(`^\\*\\*\\s*${rule.name}\\s*\\*\\*\\s*:?\\s*(.*)$`, 'i'));
    if (bold) return { id: rule.id, rest: bold[1].trim() };
    if (new RegExp(`^${rule.name}\\s*:?\\s*$`, 'i').test(trimmed)) return { id: rule.id, rest: '' };
  }
  return null;
}

function splitCite(text) {
  const cites = [];
  const pattern = /\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g;
  let match = pattern.exec(text);
  while (match) {
    for (const part of match[1].split(/[,–-]/)) {
      const n = Number(part.trim());
      if (Number.isInteger(n) && n > 0 && n < 500) cites.push(n);
    }
    match = pattern.exec(text);
  }
  const clean = text
    .replace(/\s*\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text: clean, cites: [...new Set(cites)] };
}

function bulletText(line) {
  const match = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
  return match ? match[1].trim() : null;
}

let statementSerial = 0;

export function nextStatementId() {
  statementSerial += 1;
  return `stmt-${statementSerial}`;
}

function statement(text, cites) {
  const split = splitCite(text);
  return {
    id: nextStatementId(),
    text: split.text,
    cites: cites?.length ? [...new Set(cites)] : split.cites,
  };
}

export function emptyNote() {
  return {
    subjective: [],
    objective: [],
    assessment: [],
    plan: [],
    summary: '',
  };
}

export function isolateNote(raw) {
  const text = String(raw || '')
    .replace(/<\|im_start\|>/g, '')
    .replace(/<\|im_end\|>/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
  const index = text.search(/^#{0,3}\s*(?:\*\*)?\s*subjective\b/im);
  return index >= 0 ? text.slice(index).trim() : text;
}

export function parseModelNote(raw) {
  const note = emptyNote();
  const text = isolateNote(raw);
  let current = null;
  const summaryLines = [];

  const pushStatement = (bucket, value) => {
    const cleaned = String(value || '').trim();
    if (!cleaned) return;
    if (bucket === 'summary') summaryLines.push(splitCite(cleaned).text);
    else note[bucket].push(statement(cleaned));
  };

  for (const original of text.split('\n')) {
    const line = original.trim();
    if (!line) continue;
    const heading = matchHeading(line);
    if (heading) {
      current = heading.id;
      if (heading.rest) {
        const bullet = bulletText(heading.rest) ?? heading.rest;
        pushStatement(current, bullet);
      }
      continue;
    }
    if (!current) continue;
    const bullet = bulletText(line);
    pushStatement(current, bullet ?? line);
  }

  note.summary = summaryLines.join(' ').replace(/\s{2,}/g, ' ').trim();
  const populated = SECTIONS.filter((section) => note[section.id].length > 0).length;
  return {
    ...note,
    structured: populated >= 2,
    raw: String(raw || ''),
  };
}

function keptQuoteCites(item, lines) {
  const body = item.text.replace(/^(patient|clinician):\s*/i, '');
  if (!body || !(item.cites || []).length) return null;
  const needle = body.slice(0, Math.min(48, body.length));
  const holds = item.cites.every((n) => {
    const line = lines.find((candidate) => candidate.n === n);
    return line && line.text.includes(needle);
  });
  return holds ? item.cites : null;
}

export function applySupport(note, lines) {
  const next = emptyNote();
  next.summary = note.summary;
  for (const section of SECTIONS) {
    next[section.id] = (note[section.id] || []).map((item) => ({
      ...item,
      cites: keptQuoteCites(item, lines) || supportLines(item.text, item.cites, lines),
    }));
  }
  return next;
}

const PICK_FOCUS = {
  subjective: 'symptoms, timing, and history stated by the patient',
  objective: 'vital signs, exam findings, and test results stated by the clinician',
  assessment: 'the impression the clinician stated',
  plan: 'treatment and follow-up the clinician stated',
};

const DRAFT_SYSTEM = [
  'You write one section of a prototype SOAP note.',
  'You are not a clinician and you do not give medical advice.',
  'Use only the numbered lines. Never invent vitals, medicines, allergies, or diagnoses. Never write code.',
  'Reply with 1 to 3 bullets. Each bullet is one short sentence and ends with a line number in brackets.',
  'Shape example from an unrelated note. Do not copy its facts:',
  '- The customer said the box arrived dented. [2]',
].join(' ');

function numberedLines(lines) {
  return lines
    .filter((line) => !line.label)
    .map((line) => `${line.n}| ${line.raw}`)
    .join('\n');
}

function linesForSection(lines, sectionId, focused) {
  if (!focused) return lines.filter((line) => !line.label);
  const picks = heuristicLines(sectionId, lines);
  return picks.map((n) => lines.find((line) => line.n === n)).filter(Boolean);
}

function formatPromptLines(chosen) {
  return chosen.map((line) => `${line.n}| ${line.raw}`).join('\n');
}

export function buildSectionMessages(lines, sectionId, options = {}) {
  const section = SECTIONS.find((item) => item.id === sectionId);
  const focused = options.focused !== false;
  const chosen = linesForSection(lines, sectionId, focused);
  const block = chosen.length ? formatPromptLines(chosen) : 'No matching lines.';
  return [
    {
      role: 'system',
      content:
        'Rewrite each numbered line as one bullet for a prototype SOAP note. You are not a clinician. Keep only facts from that line. End each bullet with the same line number in brackets. Do not add sentences, diagnoses, or code.',
    },
    {
      role: 'user',
      content: `${section.label} (${PICK_FOCUS[sectionId]}).\n\n${block}\n\n-`,
    },
  ];
}

export function buildLineMessage(line, sectionLabel) {
  return [
    {
      role: 'system',
      content:
        'Rewrite the transcript line as one short bullet, then stop. You are not a clinician. Use only facts from that line. End with its line number in brackets. Do not add a diagnosis or another sentence.',
    },
    {
      role: 'user',
      content: `Follow the example. Output one bullet, then stop.

2| Customer: The box arrived dented on Tuesday.
- The box arrived dented on Tuesday. [2]

${sectionLabel}
${line.n}| ${line.raw}
-`,
    },
  ];
}

export function firstDraftSentence(raw) {
  const text = String(raw || '')
    .replace(/<\|.*?\|>/g, '')
    .replace(/^\s*assistant\s*:\s*/i, '')
    .trim();
  const line = text.split('\n').map((part) => part.trim()).find(Boolean) || '';
  const bullet = line.replace(/^[-*•]\s*/, '').replace(/\s*\[\d{1,3}\]\s*$/, '').trim();
  const sentence = bullet.split(/(?<=[.!?])\s+/)[0]?.trim() || '';
  return sentence.slice(0, 220);
}

export function buildRetryMessages(lines, sectionId, options = {}) {
  const section = SECTIONS.find((item) => item.id === sectionId);
  const focused = options.focused !== false;
  const chosen = linesForSection(lines, sectionId, focused);
  const block = chosen.length ? formatPromptLines(chosen) : 'No matching lines.';
  return [
    {
      role: 'system',
      content:
        'Output one bullet per line and nothing else. Format: - <fact copied from that line> [line number]. Do not explain.',
    },
    {
      role: 'user',
      content: `${section.label}.\n\n${block}\n\n-`,
    },
  ];
}

export function buildSummaryMessages(quotes) {
  const block = (quotes || []).map((quote) => `- ${quote}`).join('\n');
  return [
    {
      role: 'system',
      content:
        'Write one or two plain sentences a patient could read. This is a prototype, not medical advice. Use only the bullets. Do not add numbers, medicines, or advice that are not written in the bullets.',
    },
    {
      role: 'user',
      content: `Bullets:\n${block || '- No details were selected.'}\n\nPatient summary:`,
    },
  ];
}

export function parseLinePicks(raw, lines) {
  const valid = new Set(lines.filter((line) => !line.label).map((line) => line.n));
  const text = String(raw || '')
    .replace(/<\|.*?\|>/g, '')
    .replace(/^\s*assistant\s*:\s*/i, '')
    .trim();
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 24) return [];
  const numericish = words.filter((word) => /\d/.test(word)).length;
  if (numericish / words.length < 0.5) return [];
  const picks = [];
  for (const word of words) {
    const match = word.match(/^\[?(\d{1,3})\]?[,.]?$/);
    if (!match) continue;
    const n = Number(match[1]);
    if (valid.has(n) && !picks.includes(n)) picks.push(n);
  }
  return picks.slice(0, 4);
}

export function heuristicLines(sectionId, lines) {
  const usable = lines.filter((line) => !line.label);
  const patient = usable.filter((line) => line.speaker === 'Patient' && line.text.length > 24);
  const clinician = usable.filter((line) => line.speaker === 'Clinician');
  const take = (rows, count = 3) => rows.slice(0, count).map((line) => line.n);
  if (sectionId === 'subjective') return take(patient, 4);
  if (sectionId === 'objective') {
    return take(
      clinician.filter((line) =>
        /vital|blood pressure|heart rate|temperature|oxygen|tender|swollen|glucose|weight|nodes|lungs/i.test(line.raw),
      ),
    );
  }
  if (sectionId === 'assessment') {
    return take(
      clinician.filter((line) => /fit|pattern|sound|impression|viral|sprain|tension|diabetes/i.test(line.text)),
      2,
    );
  }
  return take(
    clinician.filter((line) => /rest|follow|come back|prescrib|continue|log|brace|seek|fluid|ibuprofen|walk|ice/i.test(line.text)),
  );
}

const SENTENCE_FOCUS = {
  assessment: /fit|pattern|sound|impression|viral|sprain|tension|diabetes/i,
  plan: /rest|follow|come back|prescrib|continue|log|brace|seek|fluid|ibuprofen|walk|ice/i,
};

export function quotesForLines(numbers, lines, sectionId) {
  return numbers
    .map((n) => lines.find((line) => line.n === n))
    .filter(Boolean)
    .map((line) => {
      let body = line.text;
      const focus = SENTENCE_FOCUS[sectionId];
      if (focus && body.length > 160) {
        const kept = body
          .split(/(?<=[.!?])\s+/)
          .map((sentence) => sentence.trim())
          .filter((sentence) => focus.test(sentence));
        if (kept.length) body = kept.join(' ');
      }
      return {
        id: nextStatementId(),
        text: line.speaker ? `${line.speaker}: ${body}` : body,
        cites: [line.n],
      };
    });
}

export function summaryIsGrounded(summary, quotes) {
  const text = String(summary || '').trim();
  if (text.length < 20) return false;
  if (
    /```|function\s|@param|\bconst\b|\blet\b|thank you for sharing|please provide more|how can i help|as an ai|i'm sorry|i am sorry|flu-like|sounds like you|you(?:'re| are) experiencing/i.test(
      text,
    )
  ) {
    return false;
  }
  const source = (quotes || []).join(' ');
  const allowed = new Set(source.match(/\d+(?:\.\d+)?/g) || []);
  const used = text.match(/\d+(?:\.\d+)?/g) || [];
  if (used.some((value) => !allowed.has(value))) return false;
  const wanted = tokens(text);
  const known = new Set(tokens(source));
  const overlap = wanted.filter((token) => known.has(token)).length;
  return overlap >= 3;
}

function withoutSpeaker(text) {
  return String(text || '').replace(/^(patient|clinician):\s*/i, '');
}

export function fallbackSummary(sections) {
  const subjective = withoutSpeaker(sections.subjective?.[0]?.text);
  const plan = withoutSpeaker(sections.plan?.[0]?.text);
  const parts = [];
  if (subjective) parts.push(`The visit included this report: ${subjective}`);
  if (plan) parts.push(`A stated next step was: ${plan}`);
  return parts.join(' ') || 'The transcript did not include enough quoted detail for a summary.';
}

export function parseSectionOutput(raw) {
  const text = String(raw || '')
    .replace(/<\|.*?\|>/g, '')
    .replace(/^\s*assistant\s*:\s*/i, '')
    .trim();
  const bullets = [];
  const prose = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#{1,3}\s+/.test(trimmed)) continue;
    if (/^(subjective|objective|assessment|plan|patient summary)\s*:?\s*$/i.test(trimmed)) continue;
    const bullet = bulletText(trimmed);
    if (bullet) bullets.push(bullet);
    else prose.push(trimmed);
  }
  const chosen = bullets.length ? bullets : prose.slice(0, 4);
  const items = [];
  for (const value of chosen) {
    const next = statement(value);
    if (!next.text) continue;
    if (/^not documented\b/i.test(next.text)) {
      if (!items.length) items.push(next);
      break;
    }
    items.push(next);
    if (items.length >= 5) break;
  }
  return items;
}

export function looksLikeCode(value) {
  return /```|function\s|@param|\bconst\b|\blet\b|class\s+\w+/.test(String(value || ''));
}

function numbersAreAllowed(text, source) {
  const allowed = new Set(String(source || '').match(/\d+(?:\.\d+)?/g) || []);
  const used = String(text || '').match(/\d+(?:\.\d+)?/g) || [];
  return used.every((value) => allowed.has(value));
}

function nextNumberAfter(source, index) {
  const match = String(source).slice(index, index + 32).match(/\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

function mismatchedMeasure(text, source) {
  const labels = [/temperature|fever/i, /heart rate|pulse/i, /oxygen|saturation|spo2/i, /respiratory rate/i];
  for (const match of String(text).matchAll(/\d+(?:\.\d+)?/g)) {
    const window = text.slice(Math.max(0, match.index - 28), match.index + match[0].length + 12);
    const label = labels.find((pattern) => pattern.test(window));
    if (!label) continue;
    const expected = [];
    for (const found of String(source).matchAll(new RegExp(label.source, 'ig'))) {
      const next = nextNumberAfter(source, found.index);
      if (next) expected.push(next);
    }
    if (!expected.includes(match[0])) return true;
  }
  return false;
}

function overlapCount(text, source) {
  const known = new Set(tokens(source));
  return tokens(text).filter((token) => known.has(token)).length;
}

export function bulletIsGrounded(text, source) {
  const value = String(text || '').trim();
  if (value.length < 8 || looksLikeCode(value)) return false;
  if (
    /i'm sorry|i am sorry|flu-like|as an ai|thank you for sharing|please provide more|suggest|end with|line is|cannot provide|follow the example|diagnosis|myocardial|intensive care|dented|arrived on tuesday/i.test(
      value,
    )
  ) {
    return false;
  }
  if (!numbersAreAllowed(value, source)) return false;
  if (mismatchedMeasure(value, source)) return false;
  const wanted = tokens(value);
  const overlap = overlapCount(value, source);
  if (wanted.length && overlap / wanted.length < 0.45) return false;
  return overlap >= 2;
}

function looseBullets(raw) {
  const text = String(raw || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<\|.*?\|>/g, '')
    .replace(/^\s*assistant\s*:\s*/i, '')
    .trim();
  const bullets = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 240) continue;
    const bullet = bulletText(trimmed);
    if (bullet) bullets.push(bullet);
    else if (/\s\[\d{1,3}\]\s*$/.test(trimmed)) bullets.push(trimmed);
  }
  return bullets;
}

export function draftItemsFromModel(raw, lines) {
  if (looksLikeCode(raw)) return { items: [], fromModel: 0, replaced: 0 };
  const parsed = looseBullets(raw)
    .map((value) => statement(value))
    .filter((item) => item.text && !looksLikeCode(item.text));
  const items = [];
  let fromModel = 0;
  let replaced = 0;
  for (const item of parsed) {
    if (/^not documented\b/i.test(item.text)) {
      items.push({ ...item, cites: [] });
      fromModel += 1;
      continue;
    }
    const cites = supportLines(item.text, item.cites, lines);
    if (!cites.length) continue;
    const source = cites
      .map((n) => lines.find((line) => line.n === n)?.raw || '')
      .join(' ');
    if (bulletIsGrounded(item.text, source)) {
      items.push({ ...item, cites });
      fromModel += 1;
    } else {
      const quote = quotesForLines([cites[0]], lines)[0];
      if (quote) {
        items.push(quote);
        replaced += 1;
      }
    }
    if (items.length >= 4) break;
  }
  return { items, fromModel, replaced };
}

export function cleanProse(raw) {
  return parseSectionOutput(raw)
    .map((item) => item.text)
    .filter((text) => !/^not documented\b/i.test(text))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function pickerLine(picker) {
  if (picker === 'model') {
    return '> Sentences were drafted on this device and overlap the cited transcript lines.';
  }
  if (picker === 'repaired') {
    return '> Some sentences were replaced with transcript quotes because they added facts that were not in the visit.';
  }
  if (picker === 'mixed') {
    return '> Some sections were drafted by the model. Others used keyword quotes because the model reply was not usable.';
  }
  return '> The model did not return a usable section, so these quotes were chosen by keyword rules.';
}

function sectionBlock(title, items) {
  if (!items.length) return [`## ${title}`, '', '- Not documented in the transcript.', ''];
  return [
    `## ${title}`,
    '',
    ...items.map((item) => {
      const cites = item.cites?.length ? ` [${item.cites.join(', ')}]` : '';
      return `- ${item.text}${cites}`;
    }),
    '',
  ];
}

export function toMarkdown(note, meta) {
  const lines = [
    '# SOAP note (draft)',
    '',
    '> Prototype draft. Not medical advice and not for clinical use.',
    `> Model: ${meta.modelId || 'unknown'} · runtime: ${meta.runtime || 'unknown'}`,
    meta.edited ? '> Edited in the browser after the model draft.' : '> Unedited model draft.',
    ...(meta.picker ? [pickerLine(meta.picker)] : []),
    '',
  ];
  for (const section of SECTIONS) lines.push(...sectionBlock(section.label, note[section.id] || []));
  lines.push('## Patient-friendly summary', '', note.summary || 'Not documented in the transcript.', '');
  lines.push('## Transcript checklist', '');
  for (const flag of meta.flags || []) {
    const detail = flag.present
      ? `mentioned on line${flag.lines.length === 1 ? '' : 's'} ${flag.lines.join(', ')}`
      : 'not found in the transcript';
    lines.push(`- ${flag.label}: ${detail}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function toPlainText(note, meta) {
  return toMarkdown(note, meta)
    .replace(/^#+\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^- /gm, '• ');
}
