import { usePresenceStore } from "../../lib/presenceStore";

export function PresenceBadge({ userId }: { userId: string }) {
  const presences = usePresenceStore((s) => s.presences);
  const p = presences[userId];
  if (!p) return <span className="presence-badge presence-unknown" title="Unknown" />;

  const status = p.status;
  const icon = status === "online" ? "🟢" : status === "in_duel" ? "⚔️" : "⚫";
  const title = status === "online" ? "Online" : status === "in_duel" ? "In a duel" : "Offline";

  return (
    <span className={`presence-badge presence-${status}`} title={title}>
      {icon}
    </span>
  );
}
