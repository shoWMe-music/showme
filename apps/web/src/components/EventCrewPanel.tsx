import { Avatar, Icon, Modal, STATUS_COLOR, TextField } from "@showme/design-system";
import type { ReactNode } from "react";
import { useState } from "react";
import type { CrewMember } from "./EventExtraTabs";
import { VenueNotesField } from "./VenueNotesField";
import { Eyebrow, GradientButton, OutlineButton, SectionCard } from "./eventUi";
import { EMPTY_IN_HOUSE, useEventCrewPanel } from "./useEventCrewPanel";
import type { CrewInHouse, CrewTask } from "./useEventCrewPanel";

/**
 * The event's Team / Crew tab — the working version.
 *
 * It replaces `EventTeamCrewTab`, which drew the same two buttons ("From Team",
 * "+ Add Member") with no handlers behind either, so the tab looked complete and
 * did nothing. The layout is deliberately unchanged; only the buttons now lead
 * somewhere. What each one MEANS, and why they are two acts rather than one,
 * is written down in `useEventCrewPanel`.
 *
 * Dumb by design: the group fetch, the assignment and its accounting live in
 * that hook; inviting one person by email is the event's existing invite modal,
 * owned by the parent screen and opened through `onInviteCrew`.
 */
export interface EventCrewPanelProps {
  eventId: string;
  crew: CrewMember[];
  /** False for a viewer who may not put people on this event — then it reads only. */
  canManage: boolean;
  /**
   * `crew.manage` — whether In-House Management is this caller's business at all.
   *
   * Shared Team is the contact list every participant may read; In-House is the
   * venue's PRIVATE team management, and the meeting that defined the split said
   * exactly that (`docs/meeting-2026-08-settlements-and-deals.md`, 01:40:58). A
   * performer sees their own slice and not the room's staffing, so they do not get
   * the sub-tab — not a disabled one, none at all.
   *
   * Gated on `crew.manage` because that is a MANAGEMENT capability by name
   * (`packages/auth/src/presets.ts`) and it is absent from the `performer` preset.
   * Deliberately NOT `budget.view`-as-"is an operator": commit `e5928ec` removed
   * exactly that proxy from the rider path, and reintroducing it here would be the
   * same bug in a new place.
   */
  canManageCrew: boolean;
  /** Opens the event's invite modal with the role already set to crew. */
  onInviteCrew: () => void;
}

export function EventCrewPanel({
  eventId,
  crew,
  canManage,
  canManageCrew,
  onInviteCrew,
}: EventCrewPanelProps) {
  const [tab, setTab] = useState<"shared" | "inhouse">("shared");
  const panel = useEventCrewPanel(eventId);
  // Without the capability there is only one surface, so the chooser above it is
  // noise — a toggle with a single option is a control that decides nothing.
  const showInHouse = canManageCrew && tab === "inhouse";

  return (
    <div>
      {canManageCrew && (
        <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
          <SubToggle active={tab === "shared"} onClick={() => setTab("shared")}>
            <Icon name="users" size={15} /> Shared Team
          </SubToggle>
          <SubToggle active={tab === "inhouse"} onClick={() => setTab("inhouse")}>
            <Icon name="settings" size={15} /> In-House Management
          </SubToggle>
        </div>
      )}

      {!showInHouse ? (
        <>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 14,
              flexWrap: "wrap",
              gap: 12,
            }}
          >
            <div>
              <h3
                style={{
                  fontFamily: "var(--font-display)",
                  fontWeight: 600,
                  fontSize: 16,
                  margin: 0,
                  color: "var(--text)",
                }}
              >
                Team &amp; Crew
              </h3>
              <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "3px 0 0" }}>
                Visible to all event collaborators
              </p>
            </div>
            {canManage && (
              <div style={{ display: "flex", gap: 8 }}>
                <OutlineButton onClick={panel.openPicker}>
                  <Icon name="users" size={15} /> From Team
                </OutlineButton>
                <GradientButton onClick={onInviteCrew}>+ Add Member</GradientButton>
              </div>
            )}
          </div>
          <SectionCard style={{ padding: 0 }}>
            {crew.length === 0 ? (
              <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--muted)" }}>
                <Icon name="users" size={32} />
                <div style={{ fontSize: 13.5, marginTop: 12 }}>No crew members added yet.</div>
              </div>
            ) : (
              crew.map((member, index) => (
                <div
                  key={member.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "14px 18px",
                    borderTop: index === 0 ? "none" : "1px solid var(--border)",
                  }}
                >
                  <Avatar
                    src={member.avatarUrl ?? undefined}
                    alt=""
                    initials={member.initials}
                    tone="blue"
                    shape="square"
                    size={32}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13.5 }}>
                      {member.name}
                    </div>
                    <div style={{ color: "var(--muted)", fontSize: 12 }}>{member.role}</div>
                  </div>
                </div>
              ))
            )}
          </SectionCard>
        </>
      ) : (
        <InHousePanel crew={crew} panel={panel} />
      )}

      <TeamPickerModal panel={panel} />
    </div>
  );
}

/** The "From Team" picker: the caller's saved work-groups, one click to assign. */
function TeamPickerModal({ panel }: { panel: ReturnType<typeof useEventCrewPanel> }) {
  return (
    <Modal
      open={panel.pickerOpen}
      onClose={panel.closePicker}
      title="Add a team to this event"
      width={440}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
          Everyone in the team joins as crew on this event. Anyone already on the bill is skipped,
          never duplicated — and a team member without a shoWMe account can't be placed on an event,
          so invite them with “+ Add Member” instead.
        </p>
        {panel.groupsPending && (
          <span style={{ color: "var(--muted)", fontSize: 13 }}>Loading your teams…</span>
        )}
        {!panel.groupsPending && panel.groups.length === 0 && (
          <span style={{ color: "var(--muted)", fontSize: 13, lineHeight: 1.55 }}>
            You haven't saved a team yet. Build one on the Team screen and it becomes available on
            every event — or use “+ Add Member” to invite one person to this event only.
          </span>
        )}
        {panel.groups.map((group) => (
          <button
            key={group.id}
            type="button"
            disabled={panel.isAssigning}
            onClick={() => panel.assignGroup(group.id)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              width: "100%",
              textAlign: "left",
              padding: "12px 14px",
              borderRadius: 11,
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--text)",
              fontSize: 13.5,
              cursor: panel.isAssigning ? "wait" : "pointer",
            }}
          >
            <span style={{ fontWeight: 600 }}>{group.name}</span>
            <span style={{ color: "var(--muted)", fontSize: 12.5 }}>
              {group.memberCount} member{group.memberCount === 1 ? "" : "s"}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function SubToggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        borderRadius: 10,
        border: active ? "1px solid var(--brand-red)" : "1px solid var(--border)",
        background: active
          ? "color-mix(in srgb,var(--brand-red) 8%,transparent)"
          : "var(--surface)",
        color: active ? "var(--brand-red)" : "var(--text)",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/**
 * In-House Management — the operator's private working record of their own crew.
 *
 * This card used to promise "team schedules, private notes and assigned tasks"
 * and render nothing but that sentence. All three are here now:
 *
 * - **Call time** — when this person is needed, as a wall-clock time on the show's
 *   day. Deliberately NOT a run-of-show item: `schedule.view` is in the performer
 *   and crew floors and cannot be taken away, so anything on the schedule tab is
 *   public to the whole bill. See `routes/groups.ts` for the full argument.
 * - **Private note** — free text, stored on the participant, never serialized to
 *   anyone without `participants.manage`/`budget.view`.
 * - **Assigned tasks** — this person's rows from the event's To Do list, read
 *   only. Assigning happens there, and this card says so rather than growing a
 *   second, divergent assignment control.
 */
function InHousePanel({
  crew,
  panel,
}: { crew: CrewMember[]; panel: ReturnType<typeof useEventCrewPanel> }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionCard>
        <h3
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: 16,
            margin: 0,
            color: "var(--text)",
          }}
        >
          Private Team Management
        </h3>
        {/* The copy states the boundary EXACTLY as the server enforces it,
            including the part an operator would not guess: the crew member does
            not see their own call time here either, so it still has to be told
            to them. A card that overstated this would be the same bug in a new
            costume. */}
        <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "6px 0 0", lineHeight: 1.55 }}>
          Call times, notes and assigned work for your own crew. Only you and your co-operators see
          this — it is left out of what the performers, their agents and the crew themselves are
          sent, so a call time here is your plan, not their notification.
        </p>
      </SectionCard>

      {panel.inHousePending ? (
        // Held back until the tasks query lands as well as the roster. Rendering
        // early would print "Nothing assigned" under every name for a beat — a
        // small lie, but the same KIND of lie this whole card was sent to fix.
        <SectionCard>
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)" }}>
            <div style={{ fontSize: 13.5 }}>Loading your crew's private details…</div>
          </div>
        </SectionCard>
      ) : crew.length === 0 ? (
        <SectionCard>
          <div style={{ textAlign: "center", padding: "40px 20px", color: "var(--muted)" }}>
            <Icon name="users" size={32} />
            <div style={{ fontSize: 13.5, marginTop: 12 }}>
              No crew on this event yet — add someone on the Shared Team tab first.
            </div>
          </div>
        </SectionCard>
      ) : (
        crew.map((member) => (
          <InHouseCrewCard
            key={member.id}
            member={member}
            inHouse={panel.inHouse[member.id] ?? EMPTY_IN_HOUSE}
            saving={panel.isSavingInHouse}
            onSave={(next) => panel.saveInHouse(member.id, next)}
          />
        ))
      )}
    </div>
  );
}

/**
 * One crew member's card. It holds its own draft of the two editable fields —
 * local to the row, because a per-row draft lifted into the hook would be a map
 * of strings the data layer has no opinion about. Everything it knows arrives as
 * props; the only thing it emits is a save.
 */
function InHouseCrewCard({
  member,
  inHouse,
  saving,
  onSave,
}: {
  member: CrewMember;
  inHouse: CrewInHouse;
  saving: boolean;
  onSave: (next: { callTime: string | null; privateNote: string | null }) => void;
}) {
  const [callTime, setCallTime] = useState(inHouse.callTime ?? "");
  const [privateNote, setPrivateNote] = useState(inHouse.privateNote ?? "");
  const dirty =
    callTime !== (inHouse.callTime ?? "") || privateNote !== (inHouse.privateNote ?? "");

  return (
    <SectionCard>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Avatar
          src={member.avatarUrl ?? undefined}
          alt=""
          initials={member.initials}
          tone="blue"
          shape="square"
          size={32}
        />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, color: "var(--text)", fontSize: 13.5 }}>{member.name}</div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>{member.role}</div>
        </div>
        <GradientButton
          onClick={() =>
            // Empty means CLEARED, and the API's null is how that is said — an
            // empty string would store a blank rather than remove the field.
            onSave({
              callTime: callTime.trim() === "" ? null : callTime,
              privateNote: privateNote.trim() === "" ? null : privateNote.trim(),
            })
          }
          disabled={!dirty || saving}
        >
          {saving ? "Saving…" : "Save"}
        </GradientButton>
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <TextField
          label="Call time"
          type="time"
          value={callTime}
          onChange={(changeEvent) => setCallTime(changeEvent.target.value)}
          style={{ maxWidth: 180 }}
        />
        <VenueNotesField
          label="Private note"
          value={privateNote}
          onChange={setPrivateNote}
          placeholder="Anything you need to remember about this booking."
        />
        <div>
          <Eyebrow style={{ marginBottom: 8 }}>Assigned tasks</Eyebrow>
          {inHouse.tasks.length === 0 ? (
            <p style={{ margin: 0, color: "var(--dim)", fontSize: 12.5 }}>
              Nothing assigned. Hand them a task from the To Do tab.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {inHouse.tasks.map((task) => (
                <AssignedTaskRow key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}

/** One assigned task, read-only — the To Do tab is where a task is changed. */
function AssignedTaskRow({ task }: { task: CrewTask }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13 }}>
      <Icon
        name={task.completed ? "check" : "clock"}
        size={14}
        // The same green the To Do tab ticks a task off with, taken from the
        // design system rather than re-typed as a hex literal.
        color={task.completed ? STATUS_COLOR.confirmed.fg : "var(--muted)"}
      />
      <span
        style={{
          flex: 1,
          color: task.completed ? "var(--muted)" : "var(--text)",
          textDecoration: task.completed ? "line-through" : "none",
        }}
      >
        {task.title}
      </span>
      {task.dueDate && (
        <span style={{ color: "var(--dim)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
          {task.dueDate}
        </span>
      )}
    </div>
  );
}
