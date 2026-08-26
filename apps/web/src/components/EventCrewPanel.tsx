import { Avatar, Icon, Modal } from "@showme/design-system";
import type { ReactNode } from "react";
import { useState } from "react";
import type { CrewMember } from "./EventExtraTabs";
import { GradientButton, OutlineButton, SectionCard } from "./eventUi";
import { useEventCrewPanel } from "./useEventCrewPanel";

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
  /** Opens the event's invite modal with the role already set to crew. */
  onInviteCrew: () => void;
}

export function EventCrewPanel({ eventId, crew, canManage, onInviteCrew }: EventCrewPanelProps) {
  const [tab, setTab] = useState<"shared" | "inhouse">("shared");
  const panel = useEventCrewPanel(eventId);

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <SubToggle active={tab === "shared"} onClick={() => setTab("shared")}>
          <Icon name="users" size={15} /> Shared Team
        </SubToggle>
        <SubToggle active={tab === "inhouse"} onClick={() => setTab("inhouse")}>
          <Icon name="settings" size={15} /> In-House Management
        </SubToggle>
      </div>

      {tab === "shared" ? (
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
                  <Avatar initials={member.initials} tone="blue" shape="square" size={32} />
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
          <p style={{ color: "var(--muted)", fontSize: 12.5, margin: "6px 0 0" }}>
            Only visible to you. Team schedules, private notes and assigned tasks live here — manage
            assignees from the To Do tab.
          </p>
        </SectionCard>
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
          Everyone in the team joins as crew on this event. People already on the bill are skipped,
          never duplicated.
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
              background: "var(--elevated)",
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
        border: active ? "1px solid #EE5746" : "1px solid var(--border)",
        background: active ? "color-mix(in srgb,#EE5746 8%,transparent)" : "var(--surface)",
        color: active ? "#EE5746" : "var(--text)",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
