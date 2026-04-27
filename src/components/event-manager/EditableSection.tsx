import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Edit2, Save, X, Upload } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { uploadUserBinary } from "@/lib/firebaseStorageUpload";

/* ─── Editable Section Wrapper ─── */
export function EditableSection({ title, icon, children, editContent, onSave, onEditStart, saveDisabled, readOnly }: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  editContent: React.ReactNode;
  onSave: () => void;
  onEditStart?: () => void;
  saveDisabled?: boolean;
  readOnly?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg font-semibold flex items-center gap-2">
          {icon} {title}
        </h3>
        {!readOnly && (editing ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}><X className="h-3.5 w-3.5 mr-1" /> Cancel</Button>
            <Button size="sm" disabled={saveDisabled} onClick={() => { onSave(); setEditing(false); }}><Save className="h-3.5 w-3.5 mr-1" /> Save</Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => { onEditStart?.(); setEditing(true); }}><Edit2 className="h-3.5 w-3.5 mr-1" /> Edit</Button>
        ))}
      </div>
      {editing ? editContent : children}
    </div>
  );
}

/* ─── File Upload Helper ─── */
export function FileUploadButton({ onFile }: { onFile: (name: string, url: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" disabled={uploading} onClick={() => ref.current?.click()}>
        <Upload className="h-3.5 w-3.5" /> {uploading ? "Uploading..." : "Upload File"}
      </Button>
      <input ref={ref} type="file" className="hidden" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setUploading(true);
        try {
          const ext = file.name.split(".").pop() || "bin";
          const path = `event-manager/riders/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const url = await uploadUserBinary(path, file, file.type || undefined);
          onFile(file.name, url);
        } catch (err: any) {
          toast({ title: "Upload failed", description: err.message || "Could not upload file", variant: "destructive" });
        } finally {
          setUploading(false);
          e.target.value = "";
        }
      }} />
    </>
  );
}
