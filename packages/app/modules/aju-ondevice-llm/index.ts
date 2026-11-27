import { NativeModule, requireOptionalNativeModule } from "expo-modules-core";

export type OnDeviceLlmModelId = "qwen3-0.6b-int4" | "qwen3-1.7b-int4";

export type RepromptMode = "fix" | "enhance";

export interface OnDeviceLlmCapabilities {
  supported: boolean;
  abis: string[];
  totalRamMb: number;
}

export interface OnDeviceLlmModelStatus {
  id: OnDeviceLlmModelId;
  label: string;
  status: "ready" | "downloading" | "not_installed";
  ready: boolean;
  expectedSizeBytes: number;
  installedBytes: number;
  modelDir: string;
}

export interface OnDeviceLlmDownloadProgressEvent {
  modelId: OnDeviceLlmModelId;
  phase: "downloading" | "ready" | "cancelled" | "error";
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  message: string;
}

// oxlint-disable-next-line typescript/consistent-type-definitions -- expo EventsMap requires an implicit index signature from a type alias
type AjuOnDeviceLlmEvents = {
  onDownloadProgress: (event: OnDeviceLlmDownloadProgressEvent) => void;
};

declare class AjuOnDeviceLlmNativeModule extends NativeModule<AjuOnDeviceLlmEvents> {
  getCapabilities(): OnDeviceLlmCapabilities;
  getModelStatuses(): Record<OnDeviceLlmModelId, OnDeviceLlmModelStatus>;
  downloadModel(modelId: OnDeviceLlmModelId): Promise<boolean>;
  cancelDownload(modelId: OnDeviceLlmModelId): void;
  deleteModel(modelId: OnDeviceLlmModelId): Promise<boolean>;
  preloadModel(modelId: OnDeviceLlmModelId): Promise<boolean>;
  reprompt(modelId: OnDeviceLlmModelId, mode: RepromptMode, text: string): Promise<string>;
}

const nativeModule = requireOptionalNativeModule<AjuOnDeviceLlmNativeModule>("AjuOnDeviceLlm");

export function getOnDeviceLlmModule(): AjuOnDeviceLlmNativeModule | null {
  return nativeModule ?? null;
}
