/** Small square avatar that shows a leader's card art (cropped to the character),
 *  with a coloured initial fallback when there's no image. */
export function LeaderAvatar({
  image,
  name,
  color,
  size = 40,
  fill = false,
}: {
  image?: string | null;
  name: string;
  color: string;
  size?: number;
  /** Fill the parent container (used in the rankings podium) instead of a fixed size. */
  fill?: boolean;
}) {
  return (
    <div
      style={{
        width: fill ? "100%" : size,
        height: fill ? "100%" : size,
        borderRadius: fill ? "inherit" : 0,
        overflow: "hidden",
        flex: "0 0 auto",
        position: "relative",
        background: color,
        boxShadow: fill ? undefined : "0 0 0 1px rgba(236,230,216,0.25)",
      }}
    >
      {image ? (
        <img
          src={image}
          alt=""
          loading="lazy"
          draggable={false}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 14%" }}
        />
      ) : (
        /* real fallback: the pixel-art moon from the night-sea pack —
           never a plain color block */
        <img
          src="/assets/bg/avatar-moon.png"
          alt=""
          loading="lazy"
          draggable={false}
          title={name}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", imageRendering: "pixelated" }}
        />
      )}
    </div>
  );
}
