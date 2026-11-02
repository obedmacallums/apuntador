// The Whisper models the app offers, and where their runtime comes from. Plain data.
//
// transformers.js and its ONNX Runtime WASM come from jsDelivr (pinned version); the models from
// Hugging Face. Sizes are in bytes and only drive the progress bar and the "Descarga N MB" labels.
export const TJS_VERSION = '3.8.1';
const TJS_CDN = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TJS_VERSION}/dist/`;
export const RUNTIME = { lib: TJS_CDN + 'transformers.min.js', wasm: TJS_CDN + 'ort-wasm-simd-threaded.jsep.wasm', wasmSize: 21596019 };

// Each model lists its variants in order of preference. device 'wasm' runs on the processor (CPU) and works
// everywhere; 'webgpu' runs on the graphics card (GPU). dtype picks the .onnx files transformers.js loads
// (q8 → *_quantized, fp32 → no suffix, fp16 → *_fp16, q4 → *_q4), so it must match the names listed.
// The 8-bit files run poorly on the GPU, hence fp32/fp16 encoders with a 4-bit decoder there; f16 marks
// variants that need 16-bit float shaders. 'auto' is what Auto mode prefers on tablets and computers
// (phones always prefer the CPU): the GPU where it is clearly faster (Base 2.2×, Small several times).
// Tiny gains only 1.2–1.6× on the GPU for almost three times the download, so it stays on the CPU.
// 'limits' keeps big models off devices that would run out of memory.
//
// All models are the onnx-community "_timestamped" exports: their decoder also returns cross-attentions,
// which word timestamps need. With word timestamps off they match the older Xenova exports in accuracy
// and run as fast on the CPU, and much faster on the GPU (Small: 9–15 s against 60–122 s for 56 s of speech).
const hfModel = (id, common, variants, extra) => {
  const files = sizes => Object.entries(sizes).map(([name, size]) => ({ name, size, url: `https://huggingface.co/${id}/resolve/main/${name}` }));
  const shared = files(common);
  return { id, limits: {}, ...extra, variants: variants.map(v => {
    const all = shared.concat(files(v.onnx));
    return { ...v, files: all, size: all.reduce((a, f) => a + f.size, 0) };
  }) };
};
const CPU_Q8 = { device: 'wasm', dtype: 'q8' };
const GPU_FP32 = { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } };
const GPU_FP16 = { device: 'webgpu', f16: true, dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4' } };

export const MODELS = {
  tiny: hfModel('onnx-community/whisper-tiny_timestamped', {
    'config.json': 2243, 'generation_config.json': 3772, 'preprocessor_config.json': 339,
    'tokenizer.json': 2480466, 'tokenizer_config.json': 282683
  }, [
    { ...GPU_FP32, onnx: { 'onnx/encoder_model.onnx': 32894434, 'onnx/decoder_model_merged_q4.onnx': 86804581 } },
    { ...CPU_Q8, onnx: { 'onnx/encoder_model_quantized.onnx': 10097109, 'onnx/decoder_model_merged_quantized.onnx': 30730264 } }
  ], { auto: 'wasm' }),
  base: hfModel('onnx-community/whisper-base_timestamped', {
    'config.json': 2243, 'generation_config.json': 3832, 'preprocessor_config.json': 339,
    'tokenizer.json': 2480466, 'tokenizer_config.json': 282682
  }, [
    { ...GPU_FP32, onnx: { 'onnx/encoder_model.onnx': 82451730, 'onnx/decoder_model_merged_q4.onnx': 123738327 } },
    { ...CPU_Q8, onnx: { 'onnx/encoder_model_quantized.onnx': 23159167, 'onnx/decoder_model_merged_quantized.onnx': 53712708 } }
  ], { auto: 'webgpu' }),
  small: hfModel('onnx-community/whisper-small_timestamped', {
    'config.json': 2227, 'generation_config.json': 3893, 'preprocessor_config.json': 339,
    'tokenizer.json': 2480466, 'tokenizer_config.json': 282683
  }, [
    { ...GPU_FP16, onnx: { 'onnx/encoder_model_fp16.onnx': 176483570, 'onnx/decoder_model_merged_q4.onnx': 233421212 } },
    { ...GPU_FP32, onnx: { 'onnx/encoder_model.onnx': 352791798, 'onnx/decoder_model_merged_q4.onnx': 233421212 } },
    { ...CPU_Q8, onnx: { 'onnx/encoder_model_quantized.onnx': 92240498, 'onnx/decoder_model_merged_quantized.onnx': 156795750 } }
  ], { auto: 'webgpu', limits: { phone: 'warn', minMem: 2 } }),
  // Whisper Medium is left out on purpose, after testing both ways. On the CPU (32-bit WASM, 4 GB at
  // most) it runs out of memory mid-transcription. On the GPU (fp16 encoder + 4-bit decoder, 1.09 GB)
  // it took 436 s for 56 s of speech and returned 29 of 145 words, cut mid-word; Large v3 Turbo took
  // 24 s with almost no errors.
  turbo: hfModel('onnx-community/whisper-large-v3-turbo_timestamped', {
    'config.json': 1330, 'generation_config.json': 3797, 'preprocessor_config.json': 340,
    'tokenizer.json': 2480645, 'tokenizer_config.json': 282843
  }, [
    { ...GPU_FP16, onnx: { 'onnx/encoder_model_fp16.onnx': 1274403767, 'onnx/decoder_model_merged_q4.onnx': 334207912 } }
  ], { auto: 'webgpu', limits: { phone: 'off', tablet: 'warn', minMem: 4 } })
};

export const MODEL_INFO = {
  tiny: { label: 'Tiny', note: 'El más rápido. Bien con voz clara; comete más errores.' },
  base: { label: 'Base', note: 'Más preciso. Tarda más o menos el doble que Tiny.' },
  small: { label: 'Small', note: 'Bastante más preciso que Base, pero más lento.' },
  turbo: { label: 'Large v3 Turbo', note: 'El más preciso. Solo funciona con la tarjeta gráfica (WebGPU).' }
};
