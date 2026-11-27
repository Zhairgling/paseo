import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockNative } = vi.hoisted(() => ({
  mockNative: {
    getCapabilities: vi.fn(),
    getModelStatuses: vi.fn(),
    addListener: vi.fn(),
    downloadModel: vi.fn(),
    cancelDownload: vi.fn(),
    deleteModel: vi.fn(),
    preloadModel: vi.fn(),
    reprompt: vi.fn(),
  },
}));

vi.mock("react-native", () => ({
  Platform: { OS: "android" },
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

vi.mock("../../modules/aju-ondevice-llm", () => ({
  getOnDeviceLlmModule: () => mockNative,
}));

import { useOnDeviceLlmStore } from "./ondevice-llm-store";

describe("useOnDeviceLlmStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNative.getCapabilities.mockReturnValue({
      supported: true,
      abis: ["arm64-v8a"],
      totalRamMb: 15010,
    });
    mockNative.getModelStatuses.mockReturnValue({
      "qwen3-0.6b-int4": {
        id: "qwen3-0.6b-int4",
        label: "Qwen3 0.6B INT4",
        status: "ready",
        ready: true,
        expectedSizeBytes: 343_000_000,
        installedBytes: 343_000_000,
        modelDir: "/data/user/0/sh.paseo/files/ondevice-llm/qwen3-0.6b-int4",
      },
      "qwen3-1.7b-int4": {
        id: "qwen3-1.7b-int4",
        label: "Qwen3 1.7B INT4",
        status: "not_installed",
        ready: false,
        expectedSizeBytes: 977_000_000,
        installedBytes: 0,
        modelDir: "/data/user/0/sh.paseo/files/ondevice-llm/qwen3-1.7b-int4",
      },
    });
    useOnDeviceLlmStore.setState({
      selectedModel: "qwen3-0.6b-int4",
      repromptEnabled: true,
      initialized: false,
      supported: true,
      totalRamMb: 0,
      statuses: {},
      progressByModel: {},
      errorByModel: {},
      isReprompting: false,
      activeRepromptMode: null,
      lastRepromptError: null,
    });
  });

  it("reprompts an installed model and sanitizes the output", async () => {
    mockNative.reprompt.mockResolvedValue("<think>hidden</think>Regarde @src/app.tsx stp !");

    const res = await useOnDeviceLlmStore
      .getState()
      .repromptDraft("regarde @src/app.tsx stp", "fix");

    expect(mockNative.reprompt).toHaveBeenCalledWith(
      "qwen3-0.6b-int4",
      "fix",
      "regarde @src/app.tsx stp",
    );
    expect(res).toEqual({
      text: "Regarde @src/app.tsx stp !",
      changed: true,
      modelId: "qwen3-0.6b-int4",
      mode: "fix",
    });
    expect(useOnDeviceLlmStore.getState().isReprompting).toBe(false);
  });

  it("auto-downloads the selected model when none is installed yet", async () => {
    const notReadyStatuses = {
      "qwen3-0.6b-int4": {
        id: "qwen3-0.6b-int4",
        label: "Qwen3 0.6B INT4",
        status: "not_installed",
        ready: false,
        expectedSizeBytes: 343_000_000,
        installedBytes: 0,
        modelDir: "/tmp/0.6b",
      },
      "qwen3-1.7b-int4": {
        id: "qwen3-1.7b-int4",
        label: "Qwen3 1.7B INT4",
        status: "not_installed",
        ready: false,
        expectedSizeBytes: 977_000_000,
        installedBytes: 0,
        modelDir: "/tmp/1.7b",
      },
    };
    mockNative.getModelStatuses
      .mockReturnValueOnce(notReadyStatuses)
      .mockReturnValueOnce(notReadyStatuses)
      .mockReturnValue({
        ...notReadyStatuses,
        "qwen3-0.6b-int4": {
          ...notReadyStatuses["qwen3-0.6b-int4"],
          status: "ready",
          ready: true,
          installedBytes: 343_000_000,
        },
      });
    mockNative.downloadModel.mockResolvedValue(true);
    mockNative.reprompt.mockResolvedValue("Corrige ce bug.");

    const res = await useOnDeviceLlmStore.getState().repromptDraft("corrige se bug", "fix");

    expect(mockNative.downloadModel).toHaveBeenCalledWith("qwen3-0.6b-int4");
    expect(res?.text).toBe("Corrige ce bug.");
  });
});
