import { usePresenceStore } from "../../lib/presenceStore";
import { PixelIcon, type PixelIconName } from "../pixel/PixelIcon";

export function PresenceBadge({ userId }: { userId: string }) {
  const presences = usePresenceStore((s) => s.presences);
  const p = presences[userId];
  if (!p) return <span className="presence-badge presence-unknown" title="Unknown" />;

  const status = p.status;
  const icon: PixelIconName = status === "online" ? "dot" : status === "in_duel" ? "swords" : "dot";
  const title = status === "online" ? "Online" : status === "in_duel" ? "In a duel" : "Offline";

  return (
    <span className={`presence-badge presence-${status}`} title={title}>
      <PixelIcon name={icon} size={12} />
    </span>
  );
}
