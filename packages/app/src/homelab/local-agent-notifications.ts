/**
 * Web/Desktop fallback is handled by `os-notifications.ts` via Electron/Browser APIs.
 * Android interactive local notifications live in `local-agent-notifications.native.ts`.
 */
export function useLocalAgentNotifications(): void {}
