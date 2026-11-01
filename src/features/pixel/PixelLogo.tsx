/** The site's mark: Pixel Frog's ship helm (CC0, first frame of prop-helm.png)
 *  on a small walnut plank. Styled by .px-logo-mark in components.css. */
export function PixelLogoMark({ size = 42 }: { size?: number }) {
  return <span className="px-logo-mark" style={{ width: size, height: size }} aria-hidden />;
}
