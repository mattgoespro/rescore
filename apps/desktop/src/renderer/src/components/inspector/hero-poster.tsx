import { useEffect, useState, type JSX } from "react";
import { posterUrl } from "../../../../shared/types";

export default function HeroPoster({
  path,
}: {
  path: string | null;
}): JSX.Element {
  const thumb = posterUrl(path, "w185");
  const hero = posterUrl(path, "w780");
  const [src, setSrc] = useState<string | null>(thumb);

  useEffect(() => {
    setSrc(thumb);
    if (!hero || hero === thumb) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setSrc(hero);
    };
    img.src = hero;
    return () => {
      cancelled = true;
    };
  }, [thumb, hero]);

  if (!src) return <div className="hero-ph-fallback absolute inset-0" />;
  return (
    <img
      className="absolute inset-0 size-full object-cover object-top"
      src={src}
      alt=""
      onError={() => setSrc(null)}
    />
  );
}
