import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { BookmarkPlus, FolderOpen, Trash2, Loader2 } from "lucide-react";
import { fetchProfileTemplates, upsertProfileTemplate, deleteProfileTemplate } from "@/lib/db";
import { toast } from "@/hooks/use-toast";

interface SectionTemplateMenuProps {
  profileId: string;
  category: string; // e.g. "schedules", "amenities", "riders"
  currentData: unknown;
  onLoad: (data: unknown) => void;
}

interface TemplateEntry {
  id: string;
  name: string;
  data: unknown;
}

export function SectionTemplateMenu({ profileId, category, currentData, onLoad }: SectionTemplateMenuProps) {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !profileId) return;
    setLoading(true);
    fetchProfileTemplates(profileId, category)
      .then(docs => setTemplates(docs.map(d => ({ id: d.id as string, name: d.name as string, data: d.data }))))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, profileId, category]);

  const handleSave = async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    const id = `tpl-${Date.now()}`;
    await upsertProfileTemplate(profileId, category, id, { name: saveName.trim(), data: currentData });
    setTemplates(prev => [...prev, { id, name: saveName.trim(), data: currentData }]);
    setSaveName("");
    setSaving(false);
    toast({ title: "Template saved" });
  };

  const handleDelete = async (id: string) => {
    await deleteProfileTemplate(profileId, category, id);
    setTemplates(prev => prev.filter(t => t.id !== id));
    toast({ title: "Template deleted" });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
          <FolderOpen className="h-3 w-3" /> Templates
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end">
        <p className="text-xs font-semibold mb-2">Templates</p>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin mx-auto my-4" />
        ) : templates.length === 0 ? (
          <p className="text-xs text-muted-foreground mb-3">No saved templates yet.</p>
        ) : (
          <div className="space-y-1 mb-3 max-h-40 overflow-y-auto">
            {templates.map(t => (
              <div key={t.id} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted/50 group">
                <button className="flex-1 text-left text-xs font-medium truncate" onClick={() => { onLoad(t.data); setOpen(false); toast({ title: `Loaded "${t.name}"` }); }}>
                  {t.name}
                </button>
                <button className="opacity-0 group-hover:opacity-100 p-0.5" onClick={() => handleDelete(t.id)}>
                  <Trash2 className="h-3 w-3 text-destructive" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1.5 border-t pt-2">
          <Input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="Template name" className="h-7 text-xs" onKeyDown={e => { if (e.key === "Enter") handleSave(); }} />
          <Button variant="outline" size="sm" className="h-7 text-xs gap-1 shrink-0" disabled={!saveName.trim() || saving} onClick={handleSave}>
            <BookmarkPlus className="h-3 w-3" /> Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
