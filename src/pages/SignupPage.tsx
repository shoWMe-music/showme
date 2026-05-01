import { useState, useEffect, useCallback, useRef, KeyboardEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { createUserWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, signOut } from "firebase/auth";
import { FirebaseError } from "firebase/app";
import { httpsCallable } from "firebase/functions";
import { doc, getDoc } from "firebase/firestore";
import { getAuthClient } from "@/lib/firebaseAuth";
import { getFirebaseAuthErrorMessage } from "@/lib/firebaseAuthErrors";
import { getFirebaseFunctions } from "@/integrations/firebase/app";
import { getFirestoreDb } from "@/integrations/firebase/app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { OperatorRole, operatorRoleLabels, operatorRoleIcons, operatorRoleDescriptions, type ProfileLocation } from "@/lib/user-context";
import { upsertUserSettings, fetchInvitationCode, upsertProfile } from "@/lib/db";
import { queryKeys } from "@/lib/queries";
import type { InvitationCode } from "@/lib/db";
import { InvitationCodeInput } from "@/components/InvitationCodeInput";
import { OtpVerification } from "@/components/OtpVerification";
import logo from "@/assets/showme-logo.png";
import {
  ArrowRight,
  Check,
  Plus,
  X,
  Globe,
  Loader2,
  UserCircle,
  Sparkles,
} from "lucide-react";
import { AvatarUpload } from "@/components/AvatarUpload";
import { uploadUserBinary } from "@/lib/firebaseStorageUpload";

// ── Constants ────────────────────────────────────────────────────────────────

/** Map invitation/collaborator role labels to OperatorRole. */
function normalizeToOperatorRole(raw: string | undefined): OperatorRole | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  const map: Record<string, OperatorRole> = {
    venue: "venue", promoter: "promoter", organizer: "organizer",
    performer: "performer", festival: "festival",
    agent: "performer", manager: "performer",
  };
  return map[lower] ?? undefined;
}


const roleNameLabels: Record<OperatorRole, string> = {
  venue: "Venue Name",
  promoter: "Promoter Name",
  organizer: "Organizer Name",
  performer: "Performer / Act Name",
  festival: "Festival Name",
};

const roleNamePlaceholders: Record<OperatorRole, string> = {
  venue: "What is your venue called?",
  promoter: "What is your promoter company called?",
  organizer: "What is your organization called?",
  performer: "What is your performer or act name?",
  festival: "What is your festival called?",
};

const COUNTRIES = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Argentina","Armenia","Australia",
  "Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium",
  "Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei",
  "Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon","Canada","Cape Verde",
  "Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica",
  "Croatia","Cuba","Cyprus","Czech Republic","Denmark","Djibouti","Dominican Republic",
  "East Timor","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia",
  "Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany",
  "Ghana","Greece","Grenada","Guatemala","Guinea","Guyana","Haiti","Honduras","Hungary",
  "Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Ivory Coast",
  "Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kuwait","Kyrgyzstan","Laos","Latvia",
  "Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar",
  "Malawi","Malaysia","Maldives","Mali","Malta","Mauritania","Mauritius","Mexico","Moldova",
  "Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nepal",
  "Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia",
  "Norway","Oman","Pakistan","Panama","Papua New Guinea","Paraguay","Peru","Philippines",
  "Poland","Portugal","Qatar","Romania","Russia","Rwanda","Saudi Arabia","Senegal","Serbia",
  "Sierra Leone","Singapore","Slovakia","Slovenia","Somalia","South Africa","South Korea",
  "South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria",
  "Taiwan","Tajikistan","Tanzania","Thailand","Togo","Trinidad and Tobago","Tunisia","Turkey",
  "Turkmenistan","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States",
  "Uruguay","Uzbekistan","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe",
];

// ── Types ────────────────────────────────────────────────────────────────────

interface ProfileData {
  name: string;
  street: string;
  postcode: string;
  city: string;
  country: string;
  bio: string;
  genres: string[];
  socialLinks: { platform: string; url: string }[];
  capacity?: number;
  setupType?: string;
  setupSize?: number;
}

const emptyProfile: ProfileData = {
  name: "",
  street: "",
  postcode: "",
  city: "",
  country: "",
  bio: "",
  genres: [],
  socialLinks: [],
};

interface PersonalData {
  firstName: string;
  lastName: string;
  country: string;
  avatarFile: File | null;
  avatarPreview: string | null;
}

const emptyPersonal: PersonalData = {
  firstName: "",
  lastName: "",
  country: "",
  avatarFile: null,
  avatarPreview: null,
};

type StepId = "code" | "account" | "otp" | "personal" | "roles" | "profile";

interface ClaimResult {
  linkedProfileId?: string;
  linkedEventId?: string;
  recipientName?: string;
  recipientRole?: string;
}

function buildLocations(street: string, postcode: string, city: string, country: string): ProfileLocation[] {
  if (!city && !country) return [];
  return [{
    id: "loc-primary",
    label: "Primary",
    city,
    country,
    ...(street ? { street } : {}),
    ...(postcode ? { postcode } : {}),
  }];
}

// ── localStorage persistence ────────────────────────────────────────────────

const STORAGE_KEY = "showme_signup_state";

interface PersistedState {
  currentStep: StepId;
  email: string;
  invitationCode: string;
  codeData: InvitationCode | null;
  codeStatus: "idle" | "loading" | "valid" | "invalid";
  otpVerified: boolean;
  claimResult: ClaimResult | null;
  linkedProfileData: Record<string, unknown> | null;
  createFresh: boolean;
  selectedRoles: OperatorRole[];
  personal: Omit<PersonalData, "avatarFile">;
  profileRole: OperatorRole | null;
  profile: ProfileData;
  savedProfiles: Record<string, ProfileData>;
}

function loadPersistedState(): Partial<PersistedState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Partial<PersistedState>;
  } catch {
    return null;
  }
}

function clearPersistedState() {
  localStorage.removeItem(STORAGE_KEY);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function SignupPage() {
  const saved = useRef(loadPersistedState());

  const [currentStep, setCurrentStep] = useState<StepId>(saved.current?.currentStep ?? "code");
  const [email, setEmail] = useState(saved.current?.email ?? "");
  const [password, setPassword] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<OperatorRole[]>(saved.current?.selectedRoles ?? []);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  // Invitation code state
  const [invitationCode, setInvitationCode] = useState(saved.current?.invitationCode ?? "");
  const [codeData, setCodeData] = useState<InvitationCode | null>(saved.current?.codeData ?? null);
  const [codeStatus, setCodeStatus] = useState<"idle" | "loading" | "valid" | "invalid">(saved.current?.codeStatus === "valid" ? "valid" : "idle");

  // OTP state
  const [otpVerified, setOtpVerified] = useState(saved.current?.otpVerified ?? false);
  const [initialDevCode, setInitialDevCode] = useState<string | null>(null);

  // Claim result from claimInvitationCode
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(saved.current?.claimResult ?? null);

  // Linked profile data fetched after claim
  const [linkedProfileData, setLinkedProfileData] = useState<Record<string, unknown> | null>(saved.current?.linkedProfileData ?? null);
  const [createFresh, setCreateFresh] = useState(saved.current?.createFresh ?? false);

  const queryClient = useQueryClient();
  const upsertSettingsMutation = useMutation({
    mutationFn: (data: Parameters<typeof upsertUserSettings>[0]) => upsertUserSettings(data),
  });
  const { redirect, code: urlCode } = useSearch({ from: "/signup" });
  const { toast } = useToast();

  // Personal data state — avatarFile/avatarPreview can't be persisted
  const [personal, setPersonal] = useState<PersonalData>({
    ...emptyPersonal,
    firstName: saved.current?.personal?.firstName ?? "",
    lastName: saved.current?.personal?.lastName ?? "",
    country: saved.current?.personal?.country ?? "",
  });

  // Profile creation state — one profile per selected role
  const [profileRole, setProfileRole] = useState<OperatorRole | null>(saved.current?.profileRole ?? null);
  const [profile, setProfile] = useState<ProfileData>(saved.current?.profile ?? { ...emptyProfile });
  const [savedProfiles, setSavedProfiles] = useState<Record<string, ProfileData>>(saved.current?.savedProfiles ?? {});
  const [genreInput, setGenreInput] = useState("");

  // Persist state on every change
  useEffect(() => {
    const state: PersistedState = {
      currentStep, email, invitationCode, codeData, codeStatus,
      otpVerified, claimResult, linkedProfileData, createFresh,
      selectedRoles,
      personal: { firstName: personal.firstName, lastName: personal.lastName, country: personal.country, avatarPreview: null },
      profileRole, profile, savedProfiles,
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
  }, [currentStep, email, invitationCode, codeData, codeStatus, otpVerified, claimResult, linkedProfileData, createFresh, selectedRoles, personal.firstName, personal.lastName, personal.country, profileRole, profile, savedProfiles]);

  // Determine flow
  const hasLinkedProfile = !!(codeData?.linkedProfileId) && !createFresh;

  // Linked profile: skip role selection, go straight to pre-filled profile.
  const steps: StepId[] = hasLinkedProfile
    ? ["code", "account", "otp", "personal", "profile"]
    : ["code", "account", "otp", "personal", "roles", "profile"];

  const currentStepIndex = steps.indexOf(currentStep);

  const goToNextStep = useCallback(() => {
    const idx = steps.indexOf(currentStep);
    if (idx < steps.length - 1) {
      setCurrentStep(steps[idx + 1]);
    }
  }, [steps, currentStep]);

  // Auto-fill from URL code param (overrides any stored state from prior aborted signups)
  useEffect(() => {
    if (urlCode) {
      setInvitationCode(urlCode);
    }
  }, [urlCode]);

  // Validate invitation code when it reaches full length
  useEffect(() => {
    const normalized = invitationCode.replace(/-/g, "").replace(/^SHOW/, "");
    if (normalized.length < 8) {
      if (codeStatus !== "idle") setCodeStatus("idle");
      setCodeData(null);
      return;
    }

    let cancelled = false;
    const validate = async () => {
      setCodeStatus("loading");
      try {
        const code = await fetchInvitationCode(invitationCode);
        if (cancelled) return;
        if (code && code.status === "active") {
          setCodeData(code);
          setCodeStatus("valid");
          if (code.recipientEmail) {
            setEmail(code.recipientEmail);
          }
          if (code.recipientRole) {
            const role = normalizeToOperatorRole(code.recipientRole) ?? "performer";
            setProfileRole(role);
            setSelectedRoles([role]);
          }
        } else {
          setCodeData(null);
          setCodeStatus("invalid");
        }
      } catch {
        if (!cancelled) {
          setCodeData(null);
          setCodeStatus("invalid");
        }
      }
    };

    validate();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitationCode]);

  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      const googleProvider = new GoogleAuthProvider();
      await signInWithPopup(getAuthClient(), googleProvider);

      // Claim invitation code if present
      if (codeData) {
        try {
          const claimInvitationCode = httpsCallable<{ code: string }, ClaimResult>(
            getFirebaseFunctions(), "claimInvitationCode",
          );
          const result = await claimInvitationCode({ code: codeData.code });
          setClaimResult(result.data);

          if (result.data.recipientName) {
            const parts = result.data.recipientName.split(" ");
            setPersonal(prev => ({
              ...prev,
              firstName: parts[0] || "",
              lastName: parts.slice(1).join(" ") || "",
            }));
          }
        } catch (claimErr) {
          console.error("Failed to claim invitation code:", claimErr);
          await signOut(getAuthClient()).catch(() => {});
          const isEmailMismatch =
            claimErr instanceof FirebaseError && claimErr.code === "functions/permission-denied";
          if (isEmailMismatch && codeData.recipientEmail) {
            toast({
              title: "Wrong Google account",
              description: `This invitation is for ${codeData.recipientEmail}. Please sign in with that Google account.`,
              variant: "destructive",
            });
          } else {
            toast({
              title: "Could not claim invitation",
              description: claimErr instanceof Error ? claimErr.message : "Please try again.",
              variant: "destructive",
            });
          }
          return;
        }
      }

      toast({ title: "Account created", description: "Continue to set up your profile." });
      goToNextStep(); // account -> otp (will be skipped for Google)
    } catch (err) {
      toast({ title: "Google sign-in failed", description: getFirebaseAuthErrorMessage(err), variant: "destructive" });
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      try {
        await createUserWithEmailAndPassword(getAuthClient(), email.trim(), password);
      } catch (createErr) {
        // Firebase already prevents password overwrite; we surface a clearer
        // message and redirect to /login (with the code preserved) so the
        // recipient claims the invitation instead of attempting to recreate
        // an account they already have.
        const errCode = (createErr as { code?: string })?.code;
        if (errCode === "auth/email-already-in-use") {
          toast({
            title: "You already have an account",
            description: "Sign in with your existing password to claim this invitation.",
          });
          navigate({ to: "/login" });
          return;
        }
        throw createErr;
      }

      // Claim the invitation code
      if (codeData) {
        try {
          const claimInvitationCode = httpsCallable<{ code: string }, ClaimResult>(
            getFirebaseFunctions(), "claimInvitationCode",
          );
          const result = await claimInvitationCode({ code: codeData.code });
          setClaimResult(result.data);

          // Fetch linked profile data to pre-fill the form
          if (result.data.linkedProfileId) {
            try {
              const profileSnap = await getDoc(
                doc(getFirestoreDb(), "profiles", result.data.linkedProfileId),
              );
              if (profileSnap.exists()) {
                const data = profileSnap.data();
                setLinkedProfileData(data);
                const locs = Array.isArray(data.locations) ? data.locations : [];
                const primaryLoc = locs[0];
                setProfile({
                  name: (data.name as string) || "",
                  street: primaryLoc?.street || "",
                  postcode: primaryLoc?.postcode || "",
                  city: primaryLoc?.city || "",
                  country: primaryLoc?.country || "",
                  bio: (data.bio as string) || "",
                  genres: Array.isArray(data.genres) ? data.genres : [],
                  socialLinks: Array.isArray(data.socialLinks) ? data.socialLinks : [],
                  capacity: typeof data.capacity === "number" ? data.capacity : undefined,
                  setupType: typeof data.setupType === "string" ? data.setupType : undefined,
                  setupSize: typeof data.setupSize === "number" ? data.setupSize : undefined,
                });
                const role = normalizeToOperatorRole(data.role as string)
                  ?? normalizeToOperatorRole(result.data.recipientRole)
                  ?? "performer";
                setProfileRole(role);
                setSelectedRoles([role]);
              }
            } catch (profileErr) {
              console.error("Failed to fetch linked profile:", profileErr);
            }
          }

          // Pre-fill personal name from invitation
          if (result.data.recipientName) {
            const parts = result.data.recipientName.split(" ");
            setPersonal(prev => ({
              ...prev,
              firstName: parts[0] || "",
              lastName: parts.slice(1).join(" ") || "",
            }));
          }
        } catch (claimErr) {
          console.error("Failed to claim invitation code:", claimErr);
        }
      }

      toast({ title: "Account created", description: "Continue to verify your email." });
      goToNextStep(); // account -> otp
    } catch (err) {
      toast({ title: "Signup failed", description: getFirebaseAuthErrorMessage(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = useCallback(async (): Promise<string | void> => {
    const sendOtpEmail = httpsCallable<{ email: string }, { ok: true; devCode?: string }>(
      getFirebaseFunctions(), "sendOtpEmail",
    );
    const result = await sendOtpEmail({ email: email.trim().toLowerCase() });
    if (result.data.devCode) return result.data.devCode;
  }, [email]);

  // Auto-send OTP when entering the otp step
  useEffect(() => {
    if (currentStep === "otp" && email) {
      handleSendOtp()
        .then((code) => { if (code) setInitialDevCode(code); })
        .catch((err) => { console.error("Failed to send OTP:", err); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  // ── Personal step handlers ─────────────────────────────────────────────────

  const handlePersonalNext = () => {
    if (!personal.firstName.trim() || !personal.lastName.trim()) {
      toast({ title: "Please enter your first and last name", variant: "destructive" });
      return;
    }
    if (!personal.country) {
      toast({ title: "Please select your country", variant: "destructive" });
      return;
    }
    goToNextStep();
  };

  // ── Role / profile step handlers ───────────────────────────────────────────

  const toggleRole = (role: OperatorRole) => {
    setSelectedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role],
    );
  };

  const handleRolesNext = () => {
    if (selectedRoles.length === 0) {
      toast({ title: "Select at least one role", variant: "destructive" });
      return;
    }
    setProfileRole(selectedRoles[0]);
    if (!profile.name) {
      setProfile({ ...emptyProfile });
    }
    setGenreInput("");
    goToNextStep();
  };

  const handleGenreKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "," || e.key === "Enter") && genreInput.trim()) {
      e.preventDefault();
      const genre = genreInput.trim().replace(/,+$/, "");
      if (genre && !profile.genres.includes(genre)) {
        setProfile(prev => ({ ...prev, genres: [...prev.genres, genre] }));
      }
      setGenreInput("");
    }
  };

  const removeGenre = (genre: string) => {
    setProfile(prev => ({ ...prev, genres: prev.genres.filter(g => g !== genre) }));
  };

  const handleSwitchToFresh = () => {
    setCreateFresh(true);
    setProfile({ ...emptyProfile });
    setProfileRole(null);
    setSavedProfiles({});
    setSelectedRoles([]);
    setLinkedProfileData(null);
    setCurrentStep("roles");
  };

  // Multi-role profile navigation
  const currentRoleIdx = profileRole ? selectedRoles.indexOf(profileRole) : 0;
  const hasMoreRoles = currentRoleIdx < selectedRoles.length - 1;

  const advanceToNextProfile = (saveCurrent: boolean) => {
    if (saveCurrent && profileRole && profile.name) {
      setSavedProfiles(prev => ({ ...prev, [profileRole]: { ...profile } }));
    }
    const nextRole = selectedRoles[currentRoleIdx + 1];
    setProfileRole(nextRole);
    setProfile(savedProfiles[nextRole] || { ...emptyProfile });
    setGenreInput("");
  };

  // ── Finish ─────────────────────────────────────────────────────────────────

  const handleFinish = async (skip?: boolean) => {
    setLoading(true);
    const displayName = `${personal.firstName} ${personal.lastName}`.trim() || email.split("@")[0];
    const initials = personal.firstName && personal.lastName
      ? `${personal.firstName[0]}${personal.lastName[0]}`.toUpperCase()
      : displayName.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);

    // Accumulate current profile into savedProfiles
    const allProfiles = { ...savedProfiles };
    if (!skip && profileRole && profile.name) {
      allProfiles[profileRole] = profile;
    }

    try {
      // Upload avatar if selected
      let avatarUrl: string | undefined;
      if (personal.avatarFile) {
        const bytes = new Uint8Array(await personal.avatarFile.arrayBuffer());
        avatarUrl = await uploadUserBinary(
          `profile-images/avatar/${Date.now()}-avatar.webp`,
          bytes,
          personal.avatarFile.type || "image/webp",
        );
      }

      // Derive roles: from selection, or from the claimed profile role
      const effectiveRoles = selectedRoles.length > 0
        ? selectedRoles
        : [normalizeToOperatorRole(claimResult?.recipientRole) ?? normalizeToOperatorRole(codeData?.recipientRole) ?? "performer" as OperatorRole];

      await upsertSettingsMutation.mutateAsync({
        name: displayName,
        firstName: personal.firstName.trim(),
        lastName: personal.lastName.trim(),
        email,
        roles: effectiveRoles,
        defaultRole: effectiveRoles[0],
        initials,
        country: personal.country,
        ...(avatarUrl ? { avatarUrl } : {}),
      });

      // Ensure every selected role has a profile. The linked-profile claim
      // flow saves its profile separately, so it's skipped here. Otherwise we
      // create one profile per role — falling back to the user's display name
      // if they skipped the form or left the name blank. Without this,
      // signups can complete with zero profiles, which breaks event ownership,
      // date-change confirmations, and anything else keyed on profile.id.
      if (!hasLinkedProfile) {
        const uid = getAuthClient().currentUser?.uid;
        for (const role of effectiveRoles) {
          const prof = allProfiles[role];
          const name = prof?.name?.trim() || displayName;
          const locations = prof
            ? buildLocations(prof.street, prof.postcode, prof.city, prof.country)
            : [];
          await upsertProfile(role, {
            ...(uid ? { id: `${uid}__${role}` } : {}),
            role,
            name,
            locations,
            bio: prof?.bio ?? "",
            genres: prof?.genres ?? [],
            socialLinks: prof?.socialLinks ?? [],
            created: true,
            ...(avatarUrl ? { avatarUrl } : {}),
            ...(prof?.capacity ? { capacity: prof.capacity } : {}),
            ...(prof?.setupType ? { setupType: prof.setupType, setupSize: prof.setupSize } : {}),
          } as import("@/lib/user-context").SharedProfile);
        }
      }
    } catch (err) {
      console.error("Signup finish failed:", err);
      toast({
        title: "Couldn't finish account setup",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }
    setLoading(false);
    clearPersistedState();

    // Invalidate cached queries so pages show fresh data immediately
    const uid = getAuthClient().currentUser?.uid;
    if (uid) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.userSettings(uid) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.profiles(uid) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.events(uid) }),
      ]);
    }

    const eventId = claimResult?.linkedEventId || codeData?.linkedEventId;
    if (eventId && hasLinkedProfile) {
      navigate({ href: `/events/${eventId}`, replace: true });
    } else {
      navigate({ href: redirect ?? "/", replace: true });
    }
  };

  // ── Step headers ───────────────────────────────────────────────────────────

  const effectiveRole = profileRole ?? selectedRoles[0];
  const stepHeaders: Record<StepId, { title: string; description: string }> = {
    code: {
      title: "Enter your invitation code",
      description: "You need an invitation code to create an account",
    },
    account: {
      title: "Create your account",
      description: "Set up your email and password",
    },
    otp: {
      title: "Verify your email",
      description: `We'll send a verification code to ${email}`,
    },
    personal: {
      title: "About you",
      description: "Tell us a bit about yourself",
    },
    roles: {
      title: "What's your role?",
      description: "Select one or more roles that describe how you work",
    },
    profile: hasLinkedProfile
      ? { title: "Your profile", description: "Review and customize your profile before getting started" }
      : {
          title: "Create your profile",
          description: effectiveRole
            ? `Set up your ${operatorRoleLabels[effectiveRole]} profile`
            : "Set up your profile",
        },
  };

  const header = stepHeaders[currentStep];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center space-y-4">
          <img src={logo} alt="shoWMe" className="h-10 mx-auto" />
          <CardTitle className="font-display text-2xl">{header.title}</CardTitle>
          <CardDescription>{header.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Progress bar */}
          <div className="flex gap-2 mb-6">
            {steps.map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= currentStepIndex ? "bg-primary" : "bg-muted"
                }`}
              />
            ))}
          </div>

          {/* ── Step: code ──────────────────────────────────────────────── */}
          {currentStep === "code" && (
            <div className="animate-fade-in-up space-y-6" key="code">
              <div className="flex justify-center">
                <InvitationCodeInput
                  value={invitationCode}
                  onChange={setInvitationCode}
                  status={codeStatus}
                  disabled={loading}
                />
              </div>

              {codeStatus === "invalid" && (
                <p className="text-sm text-destructive text-center">
                  This code is invalid or has already been used.
                </p>
              )}
              {codeStatus === "valid" && codeData?.recipientName && (
                <p className="text-sm text-muted-foreground text-center">
                  Welcome, <span className="font-medium text-foreground">{codeData.recipientName}</span>
                </p>
              )}

              <Button className="w-full" disabled={codeStatus !== "valid"} onClick={() => goToNextStep()}>
                Continue <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
              <p className="text-sm text-muted-foreground text-center">
                Already have an account?{" "}
                <Link to="/login" className="text-primary hover:underline font-medium">Sign in</Link>
              </p>
            </div>
          )}

          {/* ── Step: account ───────────────────────────────────────────── */}
          {currentStep === "account" && (
            <div className="animate-fade-in-up" key="account">
              <form onSubmit={handleSignup} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    readOnly={!!codeData?.recipientEmail}
                    className={codeData?.recipientEmail ? "bg-muted" : ""}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating account...</>
                  ) : (
                    "Create account"
                  )}
                </Button>
                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">or</span></div>
                </div>
                <div className="space-y-2">
                  <Button type="button" variant="outline" className="w-full gap-2" onClick={handleGoogleSignIn} disabled={googleLoading}>
                    {googleLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <svg className="h-4 w-4" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                    )}
                    Continue with Google
                  </Button>
                  <Button type="button" variant="outline" className="w-full gap-2" disabled>
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.93 3.78-3.93 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10.01-10.02z"/></svg>
                    Continue with Facebook <span className="text-xs text-muted-foreground ml-auto">Coming soon</span>
                  </Button>
                </div>
                <p className="text-sm text-muted-foreground text-center">
                  Already have an account?{" "}
                  <Link to="/login" className="text-primary hover:underline font-medium">Sign in</Link>
                </p>
              </form>
            </div>
          )}

          {/* ── Step: otp ───────────────────────────────────────────────── */}
          {currentStep === "otp" && (
            <div className="animate-fade-in-up" key="otp">
              <OtpVerification
                email={email}
                onVerified={() => { setOtpVerified(true); goToNextStep(); }}
                onResend={handleSendOtp}
                initialDevCode={initialDevCode}
              />
            </div>
          )}

          {/* ── Step: personal ──────────────────────────────────────────── */}
          {currentStep === "personal" && (
            <div className="animate-fade-in-up space-y-5" key="personal">
              {/* Avatar */}
              <div className="flex flex-col items-center gap-3">
                <AvatarUpload
                  preview={personal.avatarPreview}
                  onChange={(file, url) => setPersonal(prev => ({ ...prev, avatarFile: file, avatarPreview: url }))}
                />
                <p className="text-xs text-muted-foreground">Profile picture (optional)</p>
              </div>

              {/* Name */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={personal.firstName}
                    onChange={e => setPersonal(prev => ({ ...prev, firstName: e.target.value }))}
                    placeholder="First name"
                    className="mt-1"
                    autoFocus
                  />
                </div>
                <div>
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={personal.lastName}
                    onChange={e => setPersonal(prev => ({ ...prev, lastName: e.target.value }))}
                    placeholder="Last name"
                    className="mt-1"
                  />
                </div>
              </div>

              {/* Country / Tax residency */}
              <div>
                <Label>Country of Tax Residency</Label>
                <Select
                  value={personal.country}
                  onValueChange={v => setPersonal(prev => ({ ...prev, country: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select your country" />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Used for tax reporting and invoicing purposes.
                </p>
              </div>

              <Button className="w-full" onClick={handlePersonalNext}>
                Continue <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}

          {/* ── Step: roles ─────────────────────────────────────────────── */}
          {currentStep === "roles" && (
            <div className="animate-fade-in-up space-y-4" key="roles">
              <div className="grid grid-cols-2 gap-3">
                {(Object.keys(operatorRoleLabels) as OperatorRole[]).map(role => {
                  const Icon = operatorRoleIcons[role];
                  const selected = selectedRoles.includes(role);
                  return (
                    <button
                      key={role}
                      onClick={() => toggleRole(role)}
                      className={`relative flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-all hover:border-primary/50 ${
                        selected ? "border-primary bg-primary/5" : "border-border"
                      }`}
                    >
                      {selected && (
                        <div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                          <Check className="h-3 w-3 text-primary-foreground" />
                        </div>
                      )}
                      <Icon className="h-5 w-5 text-primary" />
                      <div>
                        <p className="font-medium text-sm">{operatorRoleLabels[role]}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{operatorRoleDescriptions[role]}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
              <Button onClick={handleRolesNext} className="w-full">
                Continue <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          )}

          {/* ── Step: profile ───────────────────────────────────────────── */}
          {currentStep === "profile" && (
            <div className="animate-fade-in-up space-y-4" key="profile">
              {/* Linked profile banner */}
              {hasLinkedProfile && linkedProfileData && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="rounded-full bg-primary/10 p-2 shrink-0">
                      <UserCircle className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">A profile was pre-created for you</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        You were invited as{" "}
                        <span className="font-medium">
                          {operatorRoleLabels[(linkedProfileData.role as OperatorRole) || "performer"]}
                        </span>
                        {codeData?.linkedEventId && " and linked to an event"}.
                        Edit the details below or start fresh.
                      </p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={handleSwitchToFresh}>
                    <Sparkles className="h-3.5 w-3.5" /> Start fresh instead
                  </Button>
                </div>
              )}

              {/* Role badge + multi-profile indicator */}
              {effectiveRole && (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="gap-1.5">
                    {(() => { const Icon = operatorRoleIcons[effectiveRole]; return Icon ? <Icon className="h-3 w-3" /> : null; })()}
                    {operatorRoleLabels[effectiveRole] ?? effectiveRole}
                  </Badge>
                  {selectedRoles.length > 1 && (
                    <span className="text-xs text-muted-foreground">
                      Profile {currentRoleIdx + 1} of {selectedRoles.length}
                    </span>
                  )}
                </div>
              )}

              {/* Name */}
              <div>
                <Label>{effectiveRole ? roleNameLabels[effectiveRole] : "Display Name"}</Label>
                <Input
                  value={profile.name}
                  onChange={e => setProfile(prev => ({ ...prev, name: e.target.value }))}
                  placeholder={effectiveRole ? roleNamePlaceholders[effectiveRole] : "Your public name"}
                  className="mt-1"
                />
              </div>

              {/* Location — structured fields */}
              <div className="space-y-3">
                <Label>Location</Label>
                <Input
                  value={profile.street}
                  onChange={e => setProfile(prev => ({ ...prev, street: e.target.value }))}
                  placeholder="Street address"
                />
                <div className="grid grid-cols-[0.4fr_1fr] gap-3">
                  <Input
                    value={profile.postcode}
                    onChange={e => setProfile(prev => ({ ...prev, postcode: e.target.value }))}
                    placeholder="Postcode"
                  />
                  <Input
                    value={profile.city}
                    onChange={e => setProfile(prev => ({ ...prev, city: e.target.value }))}
                    placeholder="City"
                  />
                </div>
                <Select
                  value={profile.country}
                  onValueChange={v => setProfile(prev => ({ ...prev, country: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Country" />
                  </SelectTrigger>
                  <SelectContent>
                    {COUNTRIES.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Bio */}
              <div>
                <Label>Bio</Label>
                <Textarea
                  value={profile.bio}
                  onChange={e => setProfile(prev => ({ ...prev, bio: e.target.value }))}
                  placeholder="Tell others about yourself..."
                  className="mt-1"
                  rows={3}
                />
              </div>

              {/* Role-specific fields */}
              {effectiveRole === "venue" && (
                <div>
                  <Label>Capacity</Label>
                  <Input
                    type="number"
                    value={profile.capacity || ""}
                    onChange={e => setProfile(prev => ({ ...prev, capacity: parseInt(e.target.value) || 0 }))}
                    placeholder="Max capacity"
                    className="mt-1"
                  />
                </div>
              )}

              {effectiveRole === "performer" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Setup Type</Label>
                    <Input
                      value={profile.setupType || ""}
                      onChange={e => setProfile(prev => ({ ...prev, setupType: e.target.value }))}
                      placeholder="e.g. Solo, Duo, Full Band"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label>Setup Size</Label>
                    <Input
                      type="number"
                      value={profile.setupSize || ""}
                      onChange={e => setProfile(prev => ({ ...prev, setupSize: parseInt(e.target.value) || 1 }))}
                      placeholder="Number of performers"
                      className="mt-1"
                    />
                  </div>
                </div>
              )}

              {/* Genres */}
              <div>
                <Label>Genres</Label>
                <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
                  {profile.genres.map(genre => (
                    <Badge key={genre} variant="secondary" className="gap-1 pr-1">
                      {genre}
                      <button onClick={() => removeGenre(genre)} className="ml-0.5 rounded-full hover:bg-destructive/20 p-0.5">
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
                <Input
                  value={genreInput}
                  onChange={e => setGenreInput(e.target.value)}
                  onKeyDown={handleGenreKeyDown}
                  placeholder="Type a genre and press Enter or comma"
                />
              </div>

              {/* Social links */}
              <div>
                <Label className="flex items-center gap-1.5">
                  <Globe className="h-3.5 w-3.5" /> Social Media Links
                </Label>
                <div className="space-y-2 mt-1">
                  {profile.socialLinks.map((link, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        value={link.platform}
                        onChange={e => {
                          const links = [...profile.socialLinks];
                          links[i] = { ...links[i], platform: e.target.value };
                          setProfile(prev => ({ ...prev, socialLinks: links }));
                        }}
                        placeholder="Platform"
                        className="w-32"
                      />
                      <Input
                        value={link.url}
                        onChange={e => {
                          const links = [...profile.socialLinks];
                          links[i] = { ...links[i], url: e.target.value };
                          setProfile(prev => ({ ...prev, socialLinks: links }));
                        }}
                        placeholder="https://..."
                        className="flex-1"
                      />
                      <Button variant="ghost" size="icon" onClick={() => {
                        const links = profile.socialLinks.filter((_, j) => j !== i);
                        setProfile(prev => ({ ...prev, socialLinks: links }));
                      }}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => {
                    setProfile(prev => ({ ...prev, socialLinks: [...prev.socialLinks, { platform: "", url: "" }] }));
                  }}>
                    <Plus className="h-3 w-3 mr-1" /> Add Link
                  </Button>
                </div>
              </div>

              <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                <strong>How Shared Profiles work:</strong> Your shared profile information becomes
                visible to other shoWMe users when you accept a collaborator invitation. Your details
                will automatically be added to their Contacts list, saving time on data entry.
              </p>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => {
                  if (hasMoreRoles) advanceToNextProfile(false);
                  else handleFinish(true);
                }} disabled={loading}>
                  {hasMoreRoles ? "Skip" : "Skip for now"}
                </Button>
                <Button className="flex-1" onClick={() => {
                  if (hasMoreRoles) advanceToNextProfile(true);
                  else handleFinish();
                }} disabled={loading}>
                  {loading
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
                    : hasMoreRoles
                      ? `Next: ${operatorRoleLabels[selectedRoles[currentRoleIdx + 1]]}`
                      : "Get started"
                  }
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
