import { ClientOnly } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { initChaosOrder } from "../scenes/chaos-order";
import { initEcosystemGalaxy } from "../scenes/ecosystem-galaxy";
import { initFeatureScroll } from "../scenes/feature-scroll";
import { initHeroScene } from "../scenes/hero-scene";
import { initMotion } from "../scenes/motion";

// Runs the imperative GSAP/canvas scenes exactly once, client-side only.
// motion first so window.__lenis exists before feature-scroll reads it.
function SceneRunner() {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // guard against StrictMode double-invoke
    started.current = true;
    initMotion();
    initHeroScene();
    initChaosOrder();
    initFeatureScroll();
    initEcosystemGalaxy();
  }, []);
  return null;
}

export function Scenes() {
  return (
    <ClientOnly fallback={null}>
      <SceneRunner />
    </ClientOnly>
  );
}
