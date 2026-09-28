/**
 * GPU & Device Management with Tiered Fallback
 * Tier 1: Dedicated GPU (WebGPU with powerPreference: 'high-performance') e.g. NVIDIA RTX 4050
 * Tier 2: Integrated GPU (WebGPU with powerPreference: 'low-power') e.g. AMD Radeon 740M
 * Tier 3: CPU Fallback (ONNX Runtime WebAssembly SIMD multi-threaded)
 */

export function classifyGpuTier(info, isFallback = false) {
  if (isFallback) return "cpu";
  const desc = String(info?.description || "").toLowerCase();
  const vendor = String(info?.vendor || "").toLowerCase();
  const arch = String(info?.architecture || "").toLowerCase();

  // Known discrete / dedicated keywords
  const isDiscrete =
    vendor.includes("nvidia") ||
    desc.includes("geforce") ||
    desc.includes("rtx") ||
    desc.includes("gtx") ||
    desc.includes("discrete") ||
    (vendor.includes("amd") && (desc.includes("rx ") || desc.includes("radeon pro") || desc.includes("discrete"))) ||
    desc.includes("arc a") ||
    desc.includes("quadro");

  if (isDiscrete) return "dedicated";

  // If WebGPU is functional but not discrete, it is integrated
  const isIntegrated =
    vendor.includes("intel") ||
    vendor.includes("amd") ||
    desc.includes("radeon") ||
    desc.includes("iris") ||
    desc.includes("uhd") ||
    desc.includes("graphics") ||
    vendor.includes("apple") ||
    vendor.includes("qualcomm");

  if (isIntegrated) return "integrated";

  // Default to integrated if WebGPU hardware is present
  return info?.vendor || info?.description ? "integrated" : "unknown";
}

let _cachedDeviceResolution = null;

// Ring buffer of GPU-level events for the benchmark/session-degradation
// investigation (Phase 3). ORT creates its own WebGPU device internally, so
// this observability device cannot see ORT's uncaptured errors directly —
// but device-loss is usually physical-GPU-wide, and a lost observability
// device correlating with pipeline stage errors is the signal we need.
// performance.memory (JS heap only) can never show this.
const _gpuEventLog = [];

function _logGpuEvent(kind, detail) {
  _gpuEventLog.push({ t: Date.now(), kind, detail: String(detail ?? "").slice(0, 300) });
  if (_gpuEventLog.length > 50) _gpuEventLog.shift();
  console.warn(`[GPU-EVENT] ${kind}: ${String(detail ?? "").slice(0, 300)}`);
}

export function getGpuErrorLog() {
  return [..._gpuEventLog];
}

async function _attachObservabilityDevice(adapter) {
  // Best-effort only: failure here must never break device resolution.
  try {
    if (!adapter || typeof adapter.requestDevice !== "function") return null;
    const device = await adapter.requestDevice();
    device.addEventListener?.("uncapturederror", (e) => {
      _logGpuEvent("uncapturederror", e?.error?.message ?? e?.message ?? "unknown");
    });
    device.lost?.then?.((info) => {
      _logGpuEvent("device-lost", `${info?.reason ?? "unknown"}: ${info?.message ?? ""}`);
    });
    return device;
  } catch (e) {
    console.warn("[GPU] Observability device unavailable:", e?.message ?? e);
    return null;
  }
}

/**
 * Resolves the best available hardware tier with graceful fallback:
 * 1. Dedicated GPU -> 2. Integrated GPU -> 3. CPU (WASM)
 */
export async function resolveComputeDevice(forceTier = null) {
  if (_cachedDeviceResolution && !forceTier) {
    return _cachedDeviceResolution;
  }

  // Check WebGPU availability
  const hasWebGpu = typeof navigator !== "undefined" && Boolean(navigator.gpu);

  if (!hasWebGpu || forceTier === "cpu" || forceTier === "wasm") {
    console.log("[GPU] WebGPU unavailable or CPU forced. Using CPU/WASM tier.");
    _cachedDeviceResolution = {
      type: "cpu",
      tier: "cpu",
      label: "CPU (WebAssembly SIMD)",
      vendor: "Generic CPU",
      description: "CPU multi-threaded WASM",
      adapter: null,
      device: null,
      highPerformance: false,
    };
    return _cachedDeviceResolution;
  }

  try {
    let adapter = null;
    let highPerformance = true;

    // 1. Try High-Performance (Dedicated GPU) first
    if (forceTier !== "integrated") {
      try {
        adapter = await navigator.gpu.requestAdapter({
          powerPreference: "high-performance",
        });
        if (adapter) {
          highPerformance = true;
          console.log("[GPU] Requested high-performance adapter successfully.");
        }
      } catch (e) {
        console.warn("[GPU] Failed to request high-performance adapter:", e.message);
      }
    }

    // 2. If no adapter yet or forced integrated, try low-power / default
    if (!adapter) {
      try {
        adapter = await navigator.gpu.requestAdapter({
          powerPreference: "low-power",
        });
        highPerformance = false;
        console.log("[GPU] Falling back to low-power / integrated adapter.");
      } catch (e) {
        console.warn("[GPU] Failed to request low-power adapter:", e.message);
      }
    }

    if (!adapter) {
      try {
        adapter = await navigator.gpu.requestAdapter();
        highPerformance = false;
      } catch {}
    }

    if (!adapter) {
      console.warn("[GPU] No WebGPU adapter could be acquired. Falling back to CPU.");
      _cachedDeviceResolution = {
        type: "cpu",
        tier: "cpu",
        label: "CPU (WebAssembly SIMD)",
        vendor: "Generic CPU",
        description: "CPU multi-threaded WASM",
        adapter: null,
        device: null,
        highPerformance: false,
      };
      return _cachedDeviceResolution;
    }

    // Inspect adapter info
    const info = adapter.info || (await adapter.requestAdapterInfo?.()) || {};
    const tier = classifyGpuTier(info, adapter.isFallbackAdapter);

    let label = info.description || info.device || "GPU";
    if (info.vendor && !label.toLowerCase().includes(info.vendor.toLowerCase())) {
      label = `${info.vendor} ${label}`.trim();
    }

    const resolution = {
      type: "webgpu",
      tier, // "dedicated" | "integrated" | "unknown"
      label,
      vendor: info.vendor || "Unknown",
      architecture: info.architecture || "Unknown",
      device: info.device || "Unknown",
      description: info.description || label,
      isFallback: Boolean(adapter.isFallbackAdapter),
      highPerformance,
      adapter,
      // Observability handle only — the pipeline never renders through it.
      observabilityDevice: await _attachObservabilityDevice(adapter),
    };

    console.log(`[GPU] Hardware Selected: ${resolution.label} (${resolution.tier.toUpperCase()} GPU, highPerformance=${highPerformance})`);
    _cachedDeviceResolution = resolution;
    return resolution;
  } catch (error) {
    console.error("[GPU] Device resolution error:", error);
    _cachedDeviceResolution = {
      type: "cpu",
      tier: "cpu",
      label: "CPU (WebAssembly SIMD)",
      vendor: "Generic CPU",
      description: "CPU multi-threaded WASM",
      adapter: null,
      device: null,
      highPerformance: false,
      error: error.message,
    };
    return _cachedDeviceResolution;
  }
}

/**
 * Configure ONNX Runtime Web environment according to selected device tier
 */
export function configureOrtEnvironment(Ort, env, computeDevice) {
  try {
    const ortUrl = typeof chrome !== "undefined" && chrome?.runtime?.getURL
      ? chrome.runtime.getURL("ort/")
      : "ort/";

    if (Ort?.env?.wasm) {
      Ort.env.wasm.wasmPaths = ortUrl;
      Ort.env.wasm.proxy = false;
      Ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 4);
      Ort.env.wasm.simd = true;
    }

    if (env?.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.wasmPaths = ortUrl;
      env.backends.onnx.wasm.proxy = false;
    }

    if (computeDevice?.type === "webgpu" && Ort?.env?.webgpu) {
      Ort.env.webgpu.powerPreference = computeDevice.highPerformance ? "high-performance" : "low-power";
    }

    if (env) {
      env.allowLocalModels = true;
      env.useBrowserCache = true;
      if (typeof chrome !== "undefined" && chrome?.runtime?.getURL) {
        env.localModelPath = chrome.runtime.getURL("models/");
      }
    }
  } catch (e) {
    console.warn("[GPU] Failed configuring ORT environment:", e.message);
  }
}
