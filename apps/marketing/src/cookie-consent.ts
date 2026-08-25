/**
 * Cookie consent + Google Analytics (GA4), consent-gated for GDPR/ePrivacy.
 *
 * shoWMe is a Swedish (EU) company, so analytics cookies may only be set after
 * the visitor opts in. This module implements that with Google Consent Mode v2:
 *   - gtag is initialised with `analytics_storage: 'denied'` by default, so the
 *     GA library never writes a cookie or sends an identified hit before consent.
 *   - The GA <script> only loads once consent is granted.
 *   - The choice is remembered in localStorage and can be revisited from the
 *     Cookie Policy page (or any `[data-cookie-preferences]` control).
 *
 * The GA4 Measurement ID comes from VITE_GA_MEASUREMENT_ID (see .env.example).
 * When it's unset — local dev, preview builds — no analytics loads at all, but
 * the consent banner still works so the flow stays testable.
 */

type ConsentChoice = "granted" | "denied";

const STORAGE_KEY = "showme.cookie-consent";
const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;

// gtag pushes its raw arguments to this global queue; GA drains it once (and if)
// its script loads. dataLayer holds one array per gtag() call.
declare global {
  interface Window {
    dataLayer?: unknown[][];
    showmeCookies?: { open: () => void; reset: () => void };
  }
}

function gtag(...args: unknown[]): void {
  window.dataLayer ??= [];
  window.dataLayer.push(args);
}

function readChoice(): ConsentChoice | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null; // storage blocked (private mode / cookies off) → treat as undecided
  }
}

function writeChoice(choice: ConsentChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    /* nothing we can do if storage is blocked; consent simply won't persist */
  }
}

// Load the GA4 library. Guarded so a second grant (e.g. re-opening preferences)
// never injects a duplicate <script>.
let analyticsLoaded = false;
function loadAnalytics(): void {
  if (analyticsLoaded || !MEASUREMENT_ID) return;
  analyticsLoaded = true;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;
  document.head.appendChild(script);
  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID, { anonymize_ip: true });
}

function applyConsent(choice: ConsentChoice): void {
  gtag("consent", "update", { analytics_storage: choice });
  if (choice === "granted") loadAnalytics();
}

// ── Consent banner (injected, so no per-page HTML to maintain) ───────────────
let banner: HTMLElement | null = null;

function closeBanner(): void {
  banner?.classList.remove("is-open");
}

function decide(choice: ConsentChoice): void {
  writeChoice(choice);
  applyConsent(choice);
  closeBanner();
}

function ensureBanner(): HTMLElement {
  if (banner) return banner;
  banner = document.createElement("aside");
  banner.className = "cookie-consent";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-label", "Cookie consent");
  banner.setAttribute("aria-live", "polite");
  banner.innerHTML = `
    <div class="cookie-consent__card">
      <p class="cookie-consent__text">
        <strong>We use cookies.</strong>
        Strictly necessary cookies keep shoWMe working. With your consent we also
        use analytics cookies to understand usage and improve the platform. See our
        <a href="cookies.html">Cookie Policy</a>.
      </p>
      <div class="cookie-consent__actions">
        <button type="button" class="btn btn--ghost" data-consent="denied">Decline</button>
        <button type="button" class="btn btn--primary" data-consent="granted">Accept</button>
      </div>
    </div>`;
  for (const button of banner.querySelectorAll<HTMLButtonElement>("[data-consent]")) {
    button.addEventListener("click", () => decide(button.dataset.consent as ConsentChoice));
  }
  document.body.appendChild(banner);
  return banner;
}

function openBanner(): void {
  ensureBanner().classList.add("is-open");
}

export function initCookieConsent(): void {
  // Consent Mode default: deny analytics until the visitor opts in. Set before
  // any GA hit so nothing identifiable is sent on the pre-consent pageview.
  gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });

  const choice = readChoice();
  if (choice) {
    applyConsent(choice); // re-apply a remembered choice on every page load
  } else {
    openBanner(); // first visit (or storage cleared) → ask
  }

  // Let the Cookie Policy page (and any other control) re-open the chooser.
  for (const control of document.querySelectorAll<HTMLElement>("[data-cookie-preferences]")) {
    control.addEventListener("click", (event) => {
      event.preventDefault();
      openBanner();
    });
  }

  window.showmeCookies = {
    open: openBanner,
    reset: () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      openBanner();
    },
  };
}
