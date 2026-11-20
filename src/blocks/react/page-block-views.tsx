import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { EDGE_SHAPE_LAYERS, EDGE_SHAPE_VIEWBOX } from '../edge-shapes';
import { COUNTDOWN_LABELS, countdownTarget, embedAspectRatio, sanitizeEmbedUrl, timeLeftUntil, type CountdownUnit } from '../page-blocks';
import { headingFontSize } from '../registry';
import type { Align, BannerProps, CountdownProps, EmbedProps, Locale } from '../types';

/** Rules inline styles cannot express. Rendered once per page document (React hoists and dedupes it). */
export const PAGE_BLOCKS_CSS = [
  '.eventmii-banner-media{height:var(--eventmii-banner-h,auto)}',
  '@media (max-width:639px){.eventmii-banner-media{height:var(--eventmii-banner-h-mobile,var(--eventmii-banner-h,auto))}}',
].join('');

const justify: Record<Align, CSSProperties['justifyContent']> = { left: 'flex-start', center: 'center', right: 'flex-end' };

function mediaUrl(value: string): string | undefined {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : undefined;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

const MEDIA_STYLE: CSSProperties = { display: 'block', width: '100%', objectFit: 'cover', objectPosition: 'center' };

/**
 * The still, or a muted looping video in the same box that plays while it is on screen. Reduced
 * motion keeps the still; with no still, the video stays paused on its first frame.
 */
function BannerMedia({ image, video, alt }: { image: string | undefined; video: string | undefined; alt: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const showVideo = !!video && (!reducedMotion || !image);

  useEffect(() => {
    const element = videoRef.current;
    if (!element || !showVideo || reducedMotion || typeof IntersectionObserver === 'undefined') return;
    element.muted = true;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      if (entry.isIntersecting) void element.play().catch(() => undefined);
      else element.pause();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [showVideo, reducedMotion, video]);

  if (showVideo) {
    return (
      <video
        ref={(node) => {
          if (node) node.muted = true;
          videoRef.current = node;
        }}
        className="eventmii-banner-media"
        src={video}
        poster={image}
        style={{ ...MEDIA_STYLE, pointerEvents: 'none' }}
        autoPlay={!reducedMotion}
        muted
        loop
        playsInline
        controls={false}
        preload={reducedMotion ? 'auto' : 'metadata'}
        aria-hidden
        tabIndex={-1}
        onLoadedData={(event) => {
          if (reducedMotion) event.currentTarget.pause();
        }}
      />
    );
  }
  if (!image) return null;
  return <img className="eventmii-banner-media" src={image} alt={alt} style={MEDIA_STYLE} />;
}

/** The shaped bottom edge: the shape hangs from the top of its box, so the box is turned over. */
function BannerEdge({ props, color }: { props: BannerProps; color: string }) {
  if (!props.curve) return null;
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: 0,
        bottom: -2,
        width: '100%',
        overflow: 'hidden',
        lineHeight: 0,
        transform: props.curveFlip ? 'scaleY(-1)' : 'rotate(180deg)',
      }}
    >
      <svg
        viewBox={`0 0 ${EDGE_SHAPE_VIEWBOX.width} ${EDGE_SHAPE_VIEWBOX.height}`}
        preserveAspectRatio="none"
        style={{ position: 'relative', display: 'block', width: 'calc(100% + 1.3px)', height: props.curveHeight }}
      >
        {EDGE_SHAPE_LAYERS[props.curve].map((layer) => (
          <path key={layer.d} d={layer.d} opacity={layer.opacity} fill={color} />
        ))}
      </svg>
    </div>
  );
}

export function BannerView({ props, src, videoSrc, alt, curveColor }: { props: BannerProps; src: string; videoSrc: string; alt: string; curveColor: string | undefined }) {
  const image = mediaUrl(src);
  const video = mediaUrl(videoSrc);
  if (!image && !video) return null;
  const heights = { '--eventmii-banner-h': props.height, '--eventmii-banner-h-mobile': props.mobileHeight ?? props.height } as CSSProperties;
  return (
    <div className="eventmii-banner" style={{ position: 'relative', lineHeight: 0, ...heights }}>
      <BannerMedia image={image} video={video} alt={alt} />
      {curveColor && <BannerEdge props={props} color={curveColor} />}
    </div>
  );
}

/** The current time, ticking every second until `target` has passed. */
function useNow(target: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target === null) return;
    const id = setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (next >= target) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [target]);
  return now;
}

type CountdownTheme = { textColor: string; fontFamily: string; headingFontFamily?: string; cardRadius?: number | null };

export function CountdownView({
  props,
  heading,
  endedText,
  eventStartsAt,
  lang,
  theme,
  renderHtml,
  renderPlainText,
}: {
  props: CountdownProps;
  heading: string;
  endedText: string;
  eventStartsAt: string | null | undefined;
  lang: Locale;
  theme: CountdownTheme;
  renderHtml: (html: string) => string;
  renderPlainText: (text: string) => ReactNode;
}) {
  const target = countdownTarget(props, eventStartsAt);
  const now = useNow(target);
  if (target === null) return null;
  const ended = now >= target;
  if (ended && !endedText) return null;

  const color = props.color ?? theme.textColor;
  const units: CountdownUnit[] = props.showSeconds ? ['days', 'hours', 'minutes', 'seconds'] : ['days', 'hours', 'minutes'];
  const left = timeLeftUntil(target, now);
  return (
    <div style={{ color, textAlign: props.align }}>
      {!ended && heading.trim() && (
        <h2
          style={{ margin: '0 0 16px', fontFamily: theme.headingFontFamily ?? theme.fontFamily, fontSize: headingFontSize(2), fontWeight: 700, lineHeight: 1.2, color }}
          dangerouslySetInnerHTML={{ __html: renderHtml(heading) }}
        />
      )}
      {ended ? (
        <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{renderPlainText(endedText)}</p>
      ) : (
        <div role="timer" style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(8px, 2vw, 16px)', justifyContent: justify[props.align] }}>
          {units.map((unit) => (
            <div
              key={unit}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                minWidth: 'clamp(64px, 18vw, 100px)',
                aspectRatio: '1 / 1',
                padding: 8,
                boxSizing: 'border-box',
                backgroundColor: props.boxColor ?? 'transparent',
                border: `1px solid ${props.borderColor ?? `color-mix(in srgb, ${color} 15%, transparent)`}`,
                borderRadius: props.radius ?? theme.cardRadius ?? 8,
              }}
            >
              <span style={{ fontSize: 'clamp(20px, 5vw, 30px)', fontWeight: 500, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                {String(left[unit]).padStart(2, '0')}
              </span>
              <span style={{ fontSize: 'clamp(11px, 2.5vw, 14px)', lineHeight: 1.2 }}>{COUNTDOWN_LABELS[unit][lang]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EmbedView({ props, src }: { props: EmbedProps; src: string }) {
  const url = sanitizeEmbedUrl(src);
  if (!url) return null;
  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: embedAspectRatio(props.aspectRatio), overflow: 'hidden', borderRadius: props.radius }}>
      <iframe
        src={url}
        title="Embedded content"
        loading="lazy"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
      />
    </div>
  );
}
