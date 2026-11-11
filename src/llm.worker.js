import { installNetworkGuard } from './privacy.js';
import { WASM_MODEL } from './models.js';

let canaries = [];
installNetworkGuard(
  globalThis,
  (entry) => postMessage({ type: 'net', entry }),
  () => canaries,
);

let webEngine = null;
let generator = null;
let loadedKey = '';
let cancelFlag = false;

function post(message) {
  postMessage(message);
}

function threadCount() {
  if (!self.crossOriginIsolated) return 1;
  return Math.min(4, self.navigator?.hardwareConcurrency || 1);
}

async function loadWebGpu(modelId, id) {
  const { MLCEngine } = await import('@mlc-ai/web-llm');
  webEngine = new MLCEngine();
  webEngine.setInitProgressCallback((report) => {
    post({
      type: 'progress',
      id,
      progress: report.progress,
      text: report.text,
      runtime: 'webgpu',
      modelId,
    });
  });
  await webEngine.reload(modelId);
  generator = null;
}

async function createWasmPipeline(modelId, dtype, threads, id) {
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  env.backends.onnx.wasm.numThreads = threads;
  const files = new Map();
  let sawDownload = false;
  return {
    sawDownload: () => sawDownload,
    pipeline: await pipeline('text-generation', modelId, {
      device: 'wasm',
      dtype,
      progress_callback: (update) => {
        if (update?.status === 'download') sawDownload = true;
        if (update?.file) files.set(update.file, update);
        const items = [...files.values()];
        const loaded = items.reduce((sum, item) => sum + (item.loaded || 0), 0);
        const total = items.reduce((sum, item) => sum + (item.total || 0), 0);
        const name = update?.file ? update.file.split('/').pop() : 'model';
        const status = update?.status || 'loading';
        post({
          type: 'progress',
          id,
          progress: total ? loaded / total : 0,
          loaded,
          total,
          text: status === 'progress' || status === 'download' ? `Downloading ${name}` : `Loading ${name}`,
          runtime: 'wasm',
          modelId,
        });
      },
    }),
  };
}

async function loadWasm(modelId, dtype, id) {
  const threads = threadCount();
  try {
    const created = await createWasmPipeline(modelId, dtype, threads, id);
    generator = created.pipeline;
    webEngine = null;
    return created.sawDownload();
  } catch (error) {
    if (threads === 1) throw error;
    post({
      type: 'progress',
      id,
      progress: 0,
      text: 'Retrying the CPU model on a single WASM thread…',
      runtime: 'wasm',
      modelId,
    });
    const created = await createWasmPipeline(modelId, dtype, 1, id);
    generator = created.pipeline;
    webEngine = null;
    return created.sawDownload();
  }
}

async function ensureModel(runtime, modelId, dtype, id) {
  const key = `${runtime}::${modelId}::${dtype || ''}`;
  if (loadedKey === key && (webEngine || generator)) return { fromCache: true, runtime, modelId };
  if (webEngine) {
    try {
      await webEngine.unload();
    } catch {
      /* already unloaded */
    }
    webEngine = null;
  }
  generator = null;
  loadedKey = '';
  let sawDownload = true;
  if (runtime === 'webgpu') await loadWebGpu(modelId, id);
  else sawDownload = await loadWasm(modelId, dtype || WASM_MODEL.dtype, id);
  loadedKey = key;
  return { fromCache: sawDownload === false, runtime, modelId };
}

function extractGenerated(output) {
  const first = Array.isArray(output) ? output[0] : output;
  const text = first?.generated_text ?? first;
  if (typeof text === 'string') return text;
  if (Array.isArray(text)) {
    const last = text[text.length - 1];
    if (typeof last === 'string') return last;
    return last?.content || '';
  }
  return '';
}

async function generateWebGpu(messages, maxTokens) {
  let full = '';
  const stream = await webEngine.chat.completions.create({
    messages,
    temperature: 0,
    max_tokens: maxTokens,
    stream: true,
    stop: ['<|im_end|>', '## Transcript'],
  });
  for await (const chunk of stream) {
    if (cancelFlag) {
      await webEngine.interruptGenerate();
      break;
    }
    const delta = chunk.choices?.[0]?.delta?.content || '';
    if (!delta) continue;
    full += delta;
    post({ type: 'token', text: delta });
  }
  if (!full) full = await webEngine.getMessage();
  try {
    await webEngine.resetChat(true);
  } catch {
    /* keep the loaded weights */
  }
  return full;
}

async function generateWasm(messages, maxTokens) {
  const { TextStreamer } = await import('@huggingface/transformers');
  const prompt = generator.tokenizer.apply_chat_template(messages, {
    tokenize: false,
    add_generation_prompt: true,
  });
  if (typeof prompt !== 'string' || !prompt.includes('assistant')) {
    throw new Error('The model chat template did not produce a prompt.');
  }
  let streamed = '';
  const streamer = new TextStreamer(generator.tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true,
    callback_function: (text) => {
      if (cancelFlag) throw new Error('Stopped');
      streamed += text;
      post({ type: 'token', text });
    },
  });
  let output = '';
  try {
    const result = await generator(prompt, {
      max_new_tokens: maxTokens,
      do_sample: false,
      return_full_text: false,
      streamer,
    });
    output = extractGenerated(result);
  } catch (error) {
    if (!cancelFlag || !streamed) throw error;
  }
  return [output, streamed].sort((a, b) => b.trim().length - a.trim().length)[0] || '';
}

async function generate(runtime, messages, maxTokens) {
  cancelFlag = false;
  if (runtime === 'webgpu') return generateWebGpu(messages, maxTokens);
  return generateWasm(messages, maxTokens);
}

self.onmessage = async (event) => {
  const message = event.data || {};
  if (message.type === 'canaries') {
    canaries = message.canaries || [];
    return;
  }
  if (message.type === 'interrupt') {
    cancelFlag = true;
    try {
      await webEngine?.interruptGenerate();
    } catch {
      /* generation may already be finished */
    }
    return;
  }
  if (message.type === 'clear') {
    try {
      if (message.modelId && message.runtime === 'webgpu') {
        const { deleteModelAllInfoInCache } = await import('@mlc-ai/web-llm');
        await deleteModelAllInfoInCache(message.modelId);
      }
      if (webEngine) await webEngine.unload();
    } catch (error) {
      post({ type: 'error', id: message.id, message: error?.message || String(error) });
      return;
    }
    webEngine = null;
    generator = null;
    loadedKey = '';
    post({ type: 'cleared', id: message.id });
    return;
  }
  if (message.type !== 'draft') return;

  canaries = message.canaries || [];
  const id = message.id;
  let runtime = message.runtime;
  let modelId = message.modelId;
  let dtype = message.dtype;
  try {
    try {
      await ensureModel(runtime, modelId, dtype, id);
    } catch (error) {
      if (runtime !== 'webgpu' || !message.allowFallback) throw error;
      runtime = 'wasm';
      modelId = WASM_MODEL.id;
      dtype = WASM_MODEL.dtype;
      post({
        type: 'progress',
        id,
        progress: 0,
        text: `WebGPU did not start (${error?.message || 'error'}). Switching to the CPU model…`,
        runtime,
        modelId,
      });
      await ensureModel(runtime, modelId, dtype, id);
    }
    post({
      type: 'progress',
      id,
      progress: 1,
      text: 'Drafting the note on this device…',
      runtime,
      modelId,
    });
    const text = await generate(runtime, message.messages, message.maxTokens || 420);
    post({ type: 'result', id, text, runtime, modelId, stopped: cancelFlag });
  } catch (error) {
    post({ type: 'error', id, message: error?.message || String(error) });
  }
};
