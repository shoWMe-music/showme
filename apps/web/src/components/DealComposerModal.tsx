import { Button, Icon, Modal, Select, TextField } from "@showme/design-system";
import {
  DEAL_PARTY_ROLE_OPTIONS,
  DEAL_STRUCTURE_OPTIONS,
  DEAL_TYPE_OPTIONS,
  type DealPartyRole,
  type DealStructure,
  type DealType,
  PAYMENT_TIMING_OPTIONS,
  type PaymentTiming,
  structureNeedsGuarantee,
  structureNeedsSplit,
} from "@showme/shared";
import { Eyebrow } from "./primitives";
import type { DealComposer } from "./useDealComposer";

/** One participant on the event, as the party picker offers them. */
export interface DealPartyChoice {
  /** The `event_participants` id — what a `deal_party` points at. */
  id: string;
  label: string;
  /** The event role, shown so "Venue (host)" is distinguishable from "Venue (rental)". */
  roleLabel: string;
  /** True for an `agent` participant, which may only observe (decisions #14). */
  isAgent: boolean;
}

export interface DealComposerModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: () => void;
  composer: DealComposer;
  choices: DealPartyChoice[];
  /** The deal's payout currency — the event's base, shown so the figures have a unit. */
  currency: string;
  pending: boolean;
}

/** The sentinel the structure dropdown uses for "no settlement math at all". */
const PAPER_ONLY = "paper_only";

/**
 * Composing an agreement.
 *
 * Built around the fact that a deal is an agreement between **1..N parties**, not
 * a performer's fee: the party list is a repeatable set of lines, each naming a
 * participant and the role it holds, and two acts can divide one payout on the
 * same deal. A form with one "performer" field could not express that, and the
 * settlement engine can — so the form has to.
 *
 * Dumb by construction: every rule is in `@showme/shared/deal-terms` and every
 * piece of state is in `useDealComposer`.
 */
export function DealComposerModal({
  open,
  onClose,
  onSubmit,
  composer,
  choices,
  currency,
  pending,
}: DealComposerModalProps) {
  const { draft } = composer;
  const structureOption = DEAL_STRUCTURE_OPTIONS.find((option) => option.value === draft.structure);
  const typeOption = DEAL_TYPE_OPTIONS.find((option) => option.value === draft.type);
  const timingOption = PAYMENT_TIMING_OPTIONS.find(
    (option) => option.value === draft.paymentTiming,
  );
  const entitledLineCount = draft.parties.filter(
    (party) => party.roleInDeal === "payee" || party.roleInDeal === "split_member",
  ).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New deal"
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={pending}>
            {pending ? "Saving…" : "Save draft"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <TextField
          label="Name"
          value={draft.name}
          placeholder="Headline performance fee"
          onChange={(event) => composer.setName(event.target.value)}
        />

        <div>
          <Select
            label="Kind of deal"
            value={draft.type}
            onChange={(value) => composer.setType(value as DealType)}
            options={DEAL_TYPE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            searchable={false}
          />
          <FieldNote>{typeOption?.description}</FieldNote>
        </div>

        <div>
          <Select
            label="How it settles"
            value={draft.structure ?? PAPER_ONLY}
            onChange={(value) =>
              composer.setStructure(value === PAPER_ONLY ? null : (value as DealStructure))
            }
            options={DEAL_STRUCTURE_OPTIONS.map((option) => ({
              value: option.value ?? PAPER_ONLY,
              label: option.label,
            }))}
            searchable={false}
          />
          <FieldNote>{structureOption?.description}</FieldNote>
        </div>

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {structureNeedsGuarantee(draft.structure) && (
            <div style={{ flex: "1 1 160px" }}>
              <TextField
                label={`Fixed amount (${currency})`}
                value={draft.guaranteeAmount}
                inputMode="decimal"
                placeholder="3000"
                onChange={(event) => composer.setGuaranteeAmount(event.target.value)}
              />
            </div>
          )}
          {structureNeedsSplit(draft.structure) && (
            <div style={{ flex: "1 1 160px" }}>
              <TextField
                label="Share of the pool (%)"
                value={draft.splitPercent}
                inputMode="decimal"
                placeholder="70"
                onChange={(event) => composer.setSplitPercent(event.target.value)}
              />
            </div>
          )}
          {draft.structure !== null && (
            <div style={{ flex: "1 1 160px" }}>
              <TextField
                label={`Paid in advance (${currency})`}
                value={draft.advanceAmount}
                inputMode="decimal"
                placeholder="0"
                onChange={(event) => composer.setAdvanceAmount(event.target.value)}
              />
            </div>
          )}
        </div>

        <div>
          <Select
            label="When it is paid"
            value={draft.paymentTiming}
            onChange={(value) => composer.setPaymentTiming(value as PaymentTiming)}
            options={PAYMENT_TIMING_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            searchable={false}
          />
          <FieldNote>{timingOption?.description}</FieldNote>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Eyebrow>Parties</Eyebrow>
          {draft.parties.map((party) => {
            const chosen = choices.find((choice) => choice.id === party.participantId);
            return (
              <PartyLine
                key={party.key}
                partyKey={party.key}
                participantId={party.participantId}
                roleInDeal={party.roleInDeal}
                sharePercent={party.sharePercent}
                choices={choices}
                // An agent participant may hold no entitled line — it acts for the
                // performer, whose own line is the entitled one (decisions #14).
                roleOptions={
                  chosen?.isAgent
                    ? DEAL_PARTY_ROLE_OPTIONS.filter((option) => option.value === "observer")
                    : DEAL_PARTY_ROLE_OPTIONS
                }
                showShare={entitledLineCount > 1}
                removable={draft.parties.length > 1}
                onParticipantChange={composer.setPartyParticipant}
                onRoleChange={composer.setPartyRole}
                onShareChange={composer.setPartySharePercent}
                onRemove={composer.removeParty}
              />
            );
          })}
          <div>
            <Button
              variant="ghost"
              leftIcon={<Icon name="plus" size={14} />}
              onClick={composer.addParty}
            >
              Add a party
            </Button>
          </div>
          {entitledLineCount > 1 && (
            <FieldNote>
              More than one party is paid by this deal, so each states its share of the payout. They
              have to divide it exactly — 100%.
            </FieldNote>
          )}
        </div>

        {composer.submitAttempted && composer.problems.length > 0 && (
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              display: "flex",
              flexDirection: "column",
              gap: 6,
              color: "var(--brand-red)",
              fontSize: 12.5,
              lineHeight: 1.45,
            }}
          >
            {composer.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function FieldNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div style={{ color: "var(--dim)", fontSize: 12, lineHeight: 1.45, marginTop: 6 }}>
      {children}
    </div>
  );
}

function PartyLine({
  partyKey,
  participantId,
  roleInDeal,
  sharePercent,
  choices,
  roleOptions,
  showShare,
  removable,
  onParticipantChange,
  onRoleChange,
  onShareChange,
  onRemove,
}: {
  partyKey: string;
  participantId: string;
  roleInDeal: DealPartyRole;
  sharePercent: string;
  choices: DealPartyChoice[];
  roleOptions: typeof DEAL_PARTY_ROLE_OPTIONS;
  showShare: boolean;
  removable: boolean;
  onParticipantChange: (key: string, participantId: string) => void;
  onRoleChange: (key: string, role: DealPartyRole) => void;
  onShareChange: (key: string, percent: string) => void;
  onRemove: (key: string) => void;
}) {
  const isEntitled = roleInDeal === "payee" || roleInDeal === "split_member";
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
      <div style={{ flex: "2 1 200px" }}>
        <Select
          value={participantId}
          onChange={(value) => onParticipantChange(partyKey, value)}
          options={choices.map((choice) => ({
            value: choice.id,
            label: `${choice.label} — ${choice.roleLabel}`,
          }))}
          placeholder="Choose a participant…"
          aria-label="Party"
        />
      </div>
      <div style={{ flex: "1 1 140px" }}>
        <Select
          value={roleInDeal}
          onChange={(value) => onRoleChange(partyKey, value as DealPartyRole)}
          options={roleOptions.map((option) => ({ value: option.value, label: option.label }))}
          searchable={false}
          aria-label="Role on this deal"
        />
      </div>
      {showShare && isEntitled && (
        <div style={{ flex: "0 1 96px" }}>
          <TextField
            value={sharePercent}
            inputMode="decimal"
            placeholder="%"
            aria-label="Share of the payout, percent"
            onChange={(event) => onShareChange(partyKey, event.target.value)}
          />
        </div>
      )}
      {removable && (
        <Button variant="ghost" onClick={() => onRemove(partyKey)} aria-label="Remove this party">
          <Icon name="trash" size={14} />
        </Button>
      )}
    </div>
  );
}
