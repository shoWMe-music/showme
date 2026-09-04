import { Button, Modal, Select, TextField } from "@showme/design-system";
import { useRef, useState } from "react";
import {
  RIDER_FILE_ACCEPT,
  RIDER_TYPES,
  type RiderType,
  type RiderUploadView,
} from "./useRiderUpload";

/**
 * "Attach a rider": pick a file, say what it is, done. Dumb by design — every
 * decision (whose profile it is filed under, whether this caller may attach one
 * at all, what each of the four requests is) lives in `useRiderUpload`.
 */
export interface RiderUploadModalProps {
  open: boolean;
  onClose: () => void;
  view: RiderUploadView;
}

/** The default name: the file's own, minus its extension — editable after. */
function nameFromFile(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "");
}

export function RiderUploadModal({ open, onClose, view }: RiderUploadModalProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<RiderType>("tech");

  const close = () => {
    setFile(null);
    setName("");
    setType("tech");
    view.clearError();
    onClose();
  };

  const submit = async () => {
    if (!file || !name.trim()) return;
    const attached = await view.upload({ file, name: name.trim(), type });
    if (attached) close();
  };

  return (
    <Modal
      dismissOnScrim={false}
      open={open}
      onClose={close}
      width={520}
      title="Attach a rider"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={view.isUploading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!file || !name.trim() || view.isUploading}
          >
            {view.isUploading ? "Uploading…" : "Attach rider"}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          The file is saved to your rider library, then attached to this show — so you can re-attach
          the same rider to the next one without uploading it again.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            ref={inputRef}
            type="file"
            accept={RIDER_FILE_ACCEPT}
            aria-label="Rider file"
            onChange={(changed) => {
              const picked = changed.target.files?.[0] ?? null;
              setFile(picked);
              if (picked && !name) setName(nameFromFile(picked.name));
            }}
            style={{ fontSize: 13, color: "var(--text)" }}
          />
          {file && (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {file.name} · {Math.max(1, Math.round(file.size / 1024))} KB
            </span>
          )}
        </div>

        <TextField
          label="Name"
          value={name}
          onChange={(changed) => setName(changed.target.value)}
          placeholder="e.g. Tech rider 2026"
        />

        <Select
          label="Type"
          value={type}
          onChange={(next) => setType(next as RiderType)}
          options={[...RIDER_TYPES]}
          searchable={false}
        />

        {view.error && (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--brand-red)" }} role="alert">
            {view.error}
          </p>
        )}
      </div>
    </Modal>
  );
}
