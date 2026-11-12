import Image from 'next/image';
import type { CourtImage } from '@/content/imagery';

export function CourtPhoto({
  image,
  priority = false,
  sizes = '(min-width: 1024px) 46vw, 100vw',
}: {
  image: CourtImage;
  priority?: boolean;
  sizes?: string;
}) {
  return (
    <figure>
      <div className="relative aspect-[16/10] overflow-hidden bg-[var(--paper-2)]">
        <Image
          src={image.src}
          alt={image.alt}
          fill
          priority={priority}
          sizes={sizes}
          className={`object-cover ${image.focus ?? 'object-center'}`}
        />
      </div>
      <figcaption className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
        {image.caption}
      </figcaption>
    </figure>
  );
}
