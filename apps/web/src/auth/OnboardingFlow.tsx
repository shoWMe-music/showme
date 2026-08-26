import { postApiV1Profiles } from "@showme/api-client";
import { Button, Input, SelectCard } from "@showme/design-system";
import { PROFILE_TYPES_BY_KIND } from "@showme/shared";
import gsap from "gsap";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type AccountKind, useAuth } from "./AuthProvider";

/**
 * Per-kind onboarding copy. A user can hold MANY profiles (story.md: "ordinary
 * multi-profile membership"), so onboarding creates one or more. Legal/billing
 * (VAT, invoice numbering) is per-profile and collected LATER — not here.
 */
interface KindConfig {
  label: string;
  blurb: string;
  /** Organization-vs-individual question (skipped for operators — always a company). */
  entityQuestion: string;
  orgTitle: string;
  orgBlurb: string;
  soloTitle: string;
  soloBlurb: string;
  /** Profile name prompt when it's an organization. */
  profileQuestion: string;
  profilePlaceholder: string;
}

const KIND_ORDER: AccountKind[] = ["operator", "performer", "team_and_crew", "agent"];

const KIND_CONFIG: Record<AccountKind, KindConfig> = {
  operator: {
    label: "Venue, promoter or organizer",
    blurb: "You run the shows.",
    entityQuestion: "Do you represent an organization?",
    orgTitle: "A venue or company",
    orgBlurb: "A venue, promoter or organization.",
    soloTitle: "Independent",
    soloBlurb: "It's just me.",
    profileQuestion: "What's your venue or organization called?",
    profilePlaceholder: "The Lantern Hall",
  },
  performer: {
    label: "Performer",
    blurb: "You're the talent.",
    entityQuestion: "Do you perform as a group, or on your own?",
    orgTitle: "A group or organization",
    orgBlurb: "A band, collective or company.",
    soloTitle: "An individual",
    soloBlurb: "A solo artist — just me.",
    profileQuestion: "What's your act called?",
    profilePlaceholder: "Marlo Vance",
  },
  team_and_crew: {
    label: "Crew or production",
    blurb: "You make it happen on stage.",
    entityQuestion: "Do you run a company, or work on your own?",
    orgTitle: "A company",
    orgBlurb: "You operate as a business.",
    soloTitle: "Freelancer",
    soloBlurb: "It's just me.",
    profileQuestion: "What's your company called?",
    profilePlaceholder: "Northern Sound Co.",
  },
  agent: {
    label: "Booking agent",
    blurb: "You represent performers.",
    entityQuestion: "Are you part of an agency, or independent?",
    orgTitle: "An agency",
    orgBlurb: "Part of a booking agency.",
    soloTitle: "Independent agent",
    soloBlurb: "I work on my own.",
    profileQuestion: "What's your agency called?",
    profilePlaceholder: "Aurora Bookings",
  },
};

const configFor = (kind: AccountKind): KindConfig => KIND_CONFIG[kind];

/** A URL-safe slug from the profile name + a short random suffix (slug is unique). */
function slugify(name: string): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "profile";
  return `${base}-${Math.random().toString(36).slice(2, 6)}`;
}

type StepId = "welcome" | "kind" | "name" | "entity" | "profiles" | "review";
type Entity = "organization" | "individual";
interface DraftProfile {
  id: string;
  name: string;
  type: string;
}

/** The key is what the API stores; this is what a person should read. Falls
 * through for anything unrecognised rather than printing an empty chip. */
function profileTypeLabel(kind: AccountKind | null, key: string): string {
  if (!kind) return key;
  return (PROFILE_TYPES_BY_KIND[kind] ?? []).find((option) => option.key === key)?.label ?? key;
}

export function OnboardingFlow() {
  const { session, user, provisionAccount, refreshSession, signOut } = useAuth();
  const hasAccount = Boolean(session); // already provisioned (kind + name known)

  const [index, setIndex] = useState(0);
  const [kind, setKind] = useState<AccountKind | null>(session?.kind ?? null);
  // Operators are always a company → the entity question is skipped for them.
  const [entity, setEntity] = useState<Entity | null>(
    session?.kind === "operator" ? "organization" : null,
  );
  const [firstName, setFirstName] = useState(
    () => (user?.displayName ?? "").trim().split(" ")[0] ?? "",
  );
  const [lastName, setLastName] = useState(() =>
    (user?.displayName ?? "").trim().split(" ").slice(1).join(" "),
  );
  const fullName = `${firstName.trim()} ${lastName.trim()}`.trim();

  // Committed profiles + the one currently being typed. A user can add several.
  const [profiles, setProfiles] = useState<DraftProfile[]>([]);
  const [draftName, setDraftName] = useState("");
  const [draftType, setDraftType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeKind = kind ?? session?.kind ?? null;
  const config = activeKind ? configFor(activeKind) : null;
  const isIndividual = entity === "individual";

  const steps: StepId[] = [
    ...((hasAccount ? ["welcome"] : ["welcome", "kind", "name"]) as StepId[]),
    ...((activeKind === "operator" ? [] : ["entity"]) as StepId[]),
    "profiles",
    "review",
  ];
  // `steps` is derived from `hasAccount`, which flips to true the moment
  // `provisionAccount` succeeds — mid-`finish()`. The array then SHRINKS (welcome,
  // kind and name collapse to just welcome), and an index that was valid a moment
  // ago points past the end, so `steps[index]` is undefined and the screen renders
  // NOTHING but the Back link. That is what a user saw in production: not an error,
  // an empty page. Clamp on read rather than in an effect, so there is never a
  // frame where the two disagree.
  const stepId = steps[Math.min(index, steps.length - 1)];

  // A profile needs BOTH a name and a type. The in-progress draft only counts
  // once it's complete; a name with no type yet is "half-filled" and blocks Continue.
  const draftComplete = draftName.trim().length > 0 && draftType.length > 0;
  const draftHalfFilled = draftName.trim().length > 0 && draftType.length === 0;
  const pendingProfiles: DraftProfile[] = draftComplete
    ? [...profiles, { id: "draft", name: draftName.trim(), type: draftType }]
    : profiles;

  const stepRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  // Minimal, smooth motion: fade + rise each step in; ease the progress bar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `index` is the trigger — re-animate on every step change.
  useLayoutEffect(() => {
    if (stepRef.current) {
      gsap.fromTo(
        stepRef.current,
        { autoAlpha: 0, y: 24 },
        { autoAlpha: 1, y: 0, duration: 0.5, ease: "power3.out" },
      );
    }
  }, [index]);
  useEffect(() => {
    if (barRef.current) {
      gsap.to(barRef.current, {
        width: `${((index + 1) / steps.length) * 100}%`,
        duration: 0.5,
        ease: "power3.out",
      });
    }
  }, [index, steps.length]);

  const canAdvance =
    stepId === "welcome" ||
    (stepId === "kind" && kind !== null) ||
    (stepId === "name" && firstName.trim().length > 0 && lastName.trim().length > 0) ||
    (stepId === "entity" && entity !== null) ||
    (stepId === "profiles" && pendingProfiles.length > 0 && !draftHalfFilled);

  const goNext = () => setIndex((i) => Math.min(i + 1, steps.length - 1));
  const goBack = () => setIndex((i) => Math.max(i - 1, 0));

  /** Pick-and-advance for the single-select steps (typeform feel). */
  function choose(apply: () => void) {
    apply();
    window.setTimeout(goNext, 240);
  }

  /** Commit the current draft and reset the form for the next profile. */
  function addAnother() {
    if (!draftComplete) return;
    setProfiles((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: draftName.trim(), type: draftType },
    ]);
    setDraftName("");
    setDraftType("");
  }

  const removeProfile = (target: number) =>
    setProfiles((prev) => prev.filter((_, i) => i !== target));

  async function finish() {
    setError(null);
    setBusy(true);
    try {
      if (!activeKind) throw new Error("Please choose an account type.");
      if (pendingProfiles.length === 0) throw new Error("Add at least one profile.");
      if (!hasAccount) await provisionAccount(activeKind, fullName);
      for (const profile of pendingProfiles) {
        await postApiV1Profiles({
          // No `kind` here: the account was just provisioned with `activeKind`
          // above, and a profile inherits its owner's kind server-side. Sending
          // it would be asking a question whose only legal answer is already
          // known.
          type: profile.type || undefined,
          name: profile.name,
          slug: slugify(profile.name),
        });
      }
      await refreshSession(); // memberships now non-empty → status flips to `authed`
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Something went wrong. Please try again.",
      );
      setBusy(false);
    }
  }

  /** Enter advances from a text step (typeform feel). */
  const advanceOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && canAdvance) {
      event.preventDefault();
      goNext();
    }
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      <div style={{ height: 3, background: "var(--shape-fill)" }}>
        <div ref={barRef} style={{ height: "100%", width: "0%", background: "var(--brand-red)" }} />
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", padding: "16px 20px" }}>
        <button type="button" onClick={() => signOut()} style={ghostText}>
          Sign out
        </button>
      </div>

      <div style={{ flex: 1, display: "grid", placeItems: "center", padding: "0 24px 64px" }}>
        <div ref={stepRef} style={{ width: "100%", maxWidth: 560 }}>
          {stepId === "welcome" && (
            <Step
              eyebrow="Welcome"
              title="Let's set up your account"
              subtitle="A few quick questions — under a minute."
            >
              <Button onClick={goNext}>Get started</Button>
            </Step>
          )}

          {stepId === "kind" && (
            <Step eyebrow="Step 1" title="Which best describes you?">
              <div style={{ display: "grid", gap: 10 }}>
                {KIND_ORDER.map((value) => (
                  <SelectCard
                    key={value}
                    title={KIND_CONFIG[value].label}
                    description={KIND_CONFIG[value].blurb}
                    selected={kind === value}
                    onSelect={() =>
                      choose(() => {
                        setKind(value);
                        setEntity(value === "operator" ? "organization" : null);
                      })
                    }
                  />
                ))}
              </div>
            </Step>
          )}

          {stepId === "name" && (
            <Step eyebrow="Step 2" title="What's your name?" subtitle="So we know who's signed in.">
              <div style={{ display: "grid", gap: 10 }}>
                <Input
                  autoFocus
                  placeholder="First name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  onKeyDown={advanceOnEnter}
                  autoComplete="given-name"
                />
                <Input
                  placeholder="Last name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  onKeyDown={advanceOnEnter}
                  autoComplete="family-name"
                />
              </div>
              <NextButton onClick={goNext} disabled={!canAdvance} />
            </Step>
          )}

          {stepId === "entity" && config && (
            <Step eyebrow="Your profile" title={config.entityQuestion}>
              <div style={{ display: "grid", gap: 10 }}>
                <SelectCard
                  title={config.orgTitle}
                  description={config.orgBlurb}
                  selected={entity === "organization"}
                  onSelect={() =>
                    choose(() => {
                      setEntity("organization");
                      setDraftName("");
                    })
                  }
                />
                <SelectCard
                  title={config.soloTitle}
                  description={config.soloBlurb}
                  selected={entity === "individual"}
                  onSelect={() =>
                    choose(() => {
                      setEntity("individual");
                      setDraftName(fullName);
                    })
                  }
                />
              </div>
            </Step>
          )}

          {stepId === "profiles" && (
            <Step
              eyebrow="Your profiles"
              title="Set up your first profile"
              subtitle="Add one now — you can add more here, or anytime later."
            >
              {profiles.length > 0 && (
                <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
                  {profiles.map((profile, i) => (
                    <div key={profile.id} style={profileRow}>
                      <span>
                        <b>{profile.name}</b>
                        {profile.type ? ` · ${profileTypeLabel(activeKind, profile.type)}` : ""}
                      </span>
                      <button type="button" onClick={() => removeProfile(i)} style={ghostText}>
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <Input
                autoFocus
                placeholder={isIndividual ? "Your name or stage name" : config?.profilePlaceholder}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={advanceOnEnter}
              />
              {isIndividual && (
                <p style={{ opacity: 0.6, fontSize: 13, margin: "6px 2px 0" }}>
                  Your public name — your own, or a stage name.
                </p>
              )}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
                {(activeKind ? (PROFILE_TYPES_BY_KIND[activeKind] ?? []) : []).map((option) => (
                  <SelectCard
                    key={option.key}
                    title={option.label}
                    selected={draftType === option.key}
                    onSelect={() => setDraftType(option.key)}
                    className="onboarding-chip"
                  />
                ))}
              </div>
              {draftHalfFilled && (
                <p style={{ opacity: 0.6, fontSize: 13, margin: "10px 2px 0" }}>
                  Pick a type to continue.
                </p>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <Button variant="secondary" onClick={addAnother} disabled={!draftComplete}>
                  + Add another
                </Button>
                <Button onClick={goNext} disabled={!canAdvance}>
                  Continue
                </Button>
              </div>
            </Step>
          )}

          {stepId === "review" && (
            <Step
              eyebrow="All set"
              title="Ready to go"
              subtitle={
                pendingProfiles.length > 1
                  ? "We'll create your account and these profiles."
                  : "We'll create your account and first profile."
              }
            >
              <div
                style={{ display: "grid", gap: 8, marginBottom: 20, fontSize: 14, opacity: 0.85 }}
              >
                <SummaryRow label="Account" value={config?.label ?? ""} />
                {!hasAccount && <SummaryRow label="Name" value={fullName} />}
                {entity && (
                  <SummaryRow
                    label="Setup"
                    value={entity === "organization" ? "Organization" : "Individual"}
                  />
                )}
                {pendingProfiles.map((profile, i) => (
                  <SummaryRow
                    key={profile.id}
                    label={pendingProfiles.length > 1 ? `Profile ${i + 1}` : "Profile"}
                    value={
                      profile.type
                        ? `${profile.name} · ${profileTypeLabel(activeKind, profile.type)}`
                        : profile.name
                    }
                  />
                ))}
              </div>
              {error && (
                <p style={{ color: "var(--brand-red)", fontSize: 13, marginBottom: 12 }}>{error}</p>
              )}
              <Button onClick={finish} disabled={busy}>
                {busy ? "Setting things up…" : "Enter shoWMe"}
              </Button>
            </Step>
          )}

          {index > 0 && stepId !== "review" && (
            <button type="button" onClick={goBack} style={{ ...ghostText, marginTop: 20 }}>
              ← Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const ghostText = {
  background: "none",
  border: "none",
  color: "inherit",
  opacity: 0.5,
  cursor: "pointer",
  fontSize: 13,
} as const;

const profileRow = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  fontSize: 14,
} as const;

function Step({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          textTransform: "uppercase",
          letterSpacing: 1,
          fontSize: 12,
          opacity: 0.5,
          marginBottom: 10,
        }}
      >
        {eyebrow}
      </div>
      <h1 style={{ fontSize: 28, lineHeight: 1.2, marginBottom: subtitle ? 8 : 24 }}>{title}</h1>
      {subtitle && <p style={{ opacity: 0.7, marginBottom: 24, fontSize: 15 }}>{subtitle}</p>}
      {children}
    </div>
  );
}

function NextButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <div style={{ marginTop: 20 }}>
      <Button onClick={onClick} disabled={disabled}>
        Continue
      </Button>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}
