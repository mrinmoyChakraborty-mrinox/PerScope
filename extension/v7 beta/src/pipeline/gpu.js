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
