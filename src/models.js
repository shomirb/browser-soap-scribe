export const WASM_MODEL = {
  id: 'onnx-community/Qwen2.5-0.5B-Instruct',
  label: 'Qwen2.5 0.5B Instruct',
  hint: 'transformers.js on CPU / WASM · 8-bit ONNX, about 512 MB',
  runtime: 'wasm',
  dtype: 'q8',
};

export const WEBGPU_MODELS = [
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 1.5B Instruct',
    hint: 'WebLLM on WebGPU · q4f16 · about 1 GB',
    runtime: 'webgpu',
    dtype: '',
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    label: 'Qwen2.5 0.5B Instruct',
    hint: 'WebLLM on WebGPU · q4f16 · smaller download',
    runtime: 'webgpu',
    dtype: '',
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    label: 'Llama 3.2 1B Instruct',
    hint: 'WebLLM on WebGPU · q4f16 · the Llama download may be license-gated',
    runtime: 'webgpu',
    dtype: '',
  },
];

export const DEFAULT_WEBGPU_ID = WEBGPU_MODELS[0].id;

export function modelById(id) {
  if (id === WASM_MODEL.id) return WASM_MODEL;
  return WEBGPU_MODELS.find((model) => model.id === id) || null;
}
