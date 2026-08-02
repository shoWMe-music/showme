import type { Meta, StoryObj } from "@storybook/react";
import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { Modal } from "./Modal";
import { Button } from "@/components/atoms/Button/Button";
import { TextField } from "@/components/atoms/TextField/TextField";
import { KeyValueRow } from "@/components/molecules/KeyValueRow/KeyValueRow";
import { Stepper } from "@/components/molecules/Stepper/Stepper";
import { SelectCard } from "@/components/molecules/SelectCard/SelectCard";
import { Icon, type IconName } from "@/icons";
import { useReducedMotion } from "@/lib/useReducedMotion";

const meta = {
  title: "Molecules/Modal",
  component: Modal,
  tags: ["autodocs"],
  args: { open: false, onClose: () => {}, children: null },
} satisfies Meta<typeof Modal>;
export default meta;

type Story = StoryObj<typeof meta>;

const STEP_LABELS = ["Your Role", "Event Details", "Deal Structure"];

/* animates the step content in whenever the step changes; slides from the right
   going forward, from the left going back. (Story-specific glue, not a library
   primitive.) */
function StepPanel({ step, direction, children }: { step: number; direction: number; children: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  useLayoutEffect(() => {
    if (!container.current) return;
    const tween = gsap.fromTo(
      container.current,
      { autoAlpha: 0, x: reducedMotion ? 0 : direction >= 0 ? 18 : -18 },
      { autoAlpha: 1, x: 0, duration: reducedMotion ? 0 : 0.32, ease: "power3.out" },
    );
    return () => { tween.kill(); };
  }, [step, direction, reducedMotion]);
  return <div ref={container}>{children}</div>;
}

const ROLES: { key: string; icon: IconName; title: string; description: string }[] = [
  { key: "venue", icon: "building", title: "Venue", description: "You own the room — you host and settle." },
  { key: "promoter", icon: "star", title: "Promoter", description: "You book the talent and carry the risk." },
  { key: "organizer", icon: "calendar", title: "Organizer", description: "You run the event end to end." },
  { key: "festival", icon: "music", title: "Festival", description: "Multi-stage, multi-day programming." },
];

const STRUCTURES: { key: string; icon: IconName; title: string; description: string }[] = [
  { key: "guarantee", icon: "file", title: "Guarantee", description: "A fixed fee, paid regardless of sales." },
  { key: "door_split", icon: "users", title: "Door split", description: "A percentage of ticket revenue." },
  { key: "gvd", icon: "star", title: "Guarantee vs door", description: "Whichever of the two is greater." },
];

/** The operator's "New event" flow — a 3-step wizard (Your Role → Event Details
 * → Deal Structure), now composed from library Stepper / SelectCard / TextField. */
function CreateEventWizard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [role, setRole] = useState("venue");
  const [structure, setStructure] = useState("guarantee");

  const close = () => { setOpen(false); setStep(1); };
  const goToStep = (next: number) => { setDirection(next > step ? 1 : -1); setStep(next); };
  const isLastStep = step === 3;

  return (
    <>
      <Button variant="cta" leftIcon={<Icon name="plus" size={15} strokeWidth={2.4} />} onClick={() => setOpen(true)}>
        New event
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="New event"
        width={560}
        footer={
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <div style={{ display: "flex", gap: 10 }}>
              {step > 1 && <Button variant="secondary" onClick={() => goToStep(step - 1)}>Back</Button>}
              {isLastStep
                ? <Button variant="primary" onClick={close}>Create event</Button>
                : <Button variant="primary" onClick={() => goToStep(step + 1)}>Continue</Button>}
            </div>
          </div>
        }
      >
        <div style={{ paddingBottom: 4 }}>
          <Stepper steps={STEP_LABELS} active={step - 1} />
        </div>

        <div style={{ minHeight: 232 }}>
          <StepPanel step={step} direction={direction}>
            {step === 1 && (
              <div style={{ display: "grid", gap: 10 }}>
                {ROLES.map((option) => (
                  <SelectCard key={option.key} icon={<Icon name={option.icon} size={20} />} title={option.title} description={option.description}
                    selected={role === option.key} onSelect={() => setRole(option.key)} />
                ))}
              </div>
            )}

            {step === 2 && (
              <div style={{ display: "grid", gap: 16 }}>
                <TextField label="Event name" placeholder="Kiasmos — live" />
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <TextField label="Date" placeholder="2026-09-12" />
                  <TextField label="Capacity" placeholder="1,200" />
                </div>
                <TextField label="Venue" placeholder="Södra Teatern" />
              </div>
            )}

            {step === 3 && (
              <div style={{ display: "grid", gap: 10 }}>
                {STRUCTURES.map((option) => (
                  <SelectCard key={option.key} icon={<Icon name={option.icon} size={20} />} title={option.title} description={option.description}
                    selected={structure === option.key} onSelect={() => setStructure(option.key)} />
                ))}
                {structure === "guarantee" && (
                  <div style={{ marginTop: 4 }}>
                    <TextField label="Guarantee amount" placeholder="€3,000" />
                  </div>
                )}
              </div>
            )}
          </StepPanel>
        </div>
      </Modal>
    </>
  );
}

export const CreateEvent: Story = { render: () => <CreateEventWizard /> };

export const VenueSpecs: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button variant="secondary" onClick={() => setOpen(true)}>Open venue specs</Button>
        <Modal
          open={open}
          onClose={() => setOpen(false)}
          title="Venue Specs — Södra Teatern"
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>
              <Button onClick={() => setOpen(false)}>Save changes</Button>
            </>
          }
        >
          <KeyValueRow label="Capacity" value="1,200" mono />
          <KeyValueRow label="Sound system" value="d&b audiotechnik" />
          <KeyValueRow label="Stage" value="12m × 8m" mono />
          <KeyValueRow label="Curfew" value="02:00" mono />
        </Modal>
      </>
    );
  },
};
