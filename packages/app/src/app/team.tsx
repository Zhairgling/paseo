import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { TeamScreen } from "@/screens/team-screen";

export default function TeamRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <TeamScreen />
    </HostRouteBootstrapBoundary>
  );
}
