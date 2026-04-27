import { useEffect, useRef, useCallback } from "react";

/**
 * Scroll-reveal hook — adds a `.revealed` class when elements enter the viewport.
 * Attach the returned ref to any wrapper element.
 */
export function useScrollReveal<T extends HTMLElement = HTMLDivElement>(
  options?: IntersectionObserverInit
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("revealed");
          observer.unobserve(el);
        }
      },
      { threshold: 0.15, ...options }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return ref;
}

/**
 * Wrapper component for scroll-reveal sections.
 * Children start invisible and animate in when scrolled into view.
 */
export function RevealSection({
  children,
  className = "",
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useScrollReveal<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={`opacity-0 translate-y-6 transition-all duration-700 ease-out [&.revealed]:opacity-100 [&.revealed]:translate-y-0 ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
