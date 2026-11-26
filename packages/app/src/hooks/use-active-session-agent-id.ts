import { usePathname } from "expo-router";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { findPaneById } from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";

const AGENT_ROUTE_RE = /\/agent\/([^/?#]+)/;

/**
 * Returns the currently visible conversation's agentId across both workspace tabs
 * (`/h/<serverId>/workspace/<workspaceId>`) and direct agent routes (`/h/<serverId>/agent/<id>`).
 */
export function useActiveSessionAgentId(): string | null {
  const pathname = usePathname();
  const selection = useActiveWorkspaceSelection();
  const persistenceKey = selection
    ? buildWorkspaceTabPersistenceKey({
        serverId: selection.serverId,
        workspaceId: selection.workspaceId,
      })
    : null;

  const workspaceActiveAgentId = useWorkspaceLayoutStore((state) => {
    if (!persistenceKey) return null;
    const layout = state.layoutByWorkspace[persistenceKey];
    if (!layout) return null;
    const pane = findPaneById(layout.root, layout.focusedPaneId);
    const activeTabId = pane?.focusedTabId ?? pane?.tabIds[0] ?? null;
    if (!activeTabId) return null;
    const tab = state.getWorkspaceTabs(persistenceKey).find((entry) => entry.tabId === activeTabId);
    if (!tab) return null;
    if (tab.target.kind === "agent") return tab.target.agentId;
    if (tab.target.kind === "provider_subagent") return tab.target.parentAgentId;
    return null;
  });

  if (workspaceActiveAgentId) {
    return workspaceActiveAgentId;
  }

  const routeMatch = AGENT_ROUTE_RE.exec(pathname);
  return routeMatch?.[1] ? decodeURIComponent(routeMatch[1]) : null;
}
