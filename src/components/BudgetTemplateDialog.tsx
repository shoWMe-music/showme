import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, FolderOpen, Trash2 } from "lucide-react";
import type { BudgetTemplate, BudgetField } from "@/lib/budget-types";
import { deleteBudgetTemplate, fetchBudgetTemplates, insertBudgetTemplate } from "@/lib/db";
import { toast } from "@/hooks/use-toast";
import { queryKeys } from "@/lib/queries";

interface BudgetTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "save" | "load";
  profileId: string;
  currentFields: { revenueFields: BudgetField[]; costFields: BudgetField[]; resultFields: BudgetField[] };
  onLoad: (template: BudgetTemplate) => void;
}

export default function BudgetTemplateDialog({ open, onOpenChange, mode, profileId, currentFields, onLoad }: BudgetTemplateDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState<"venue_default" | "promoter" | "custom">("custom");

  const { data: rawTemplates, isPending: loading } = useQuery({
    queryKey: queryKeys.budgetTemplates(profileId),
    queryFn: () => fetchBudgetTemplates(profileId),
    enabled: open && !!profileId,
  });

  const templates: BudgetTemplate[] = (rawTemplates || []).map((r: Record<string, unknown>) => ({
    id: r.id as string,
    name: r.name as string,
    type: r.type as BudgetTemplate["type"],
    revenueFields: ((r.revenue_fields ?? r.revenueFields) as BudgetField[]) || [],
    costFields: ((r.cost_fields ?? r.costFields) as BudgetField[]) || [],
    resultFields: ((r.result_fields ?? r.resultFields) as BudgetField[]) || [],
  }));

  const insertMutation = useMutation({
    mutationFn: (payload: Parameters<typeof insertBudgetTemplate>[1]) =>
      insertBudgetTemplate(profileId, payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.budgetTemplates(profileId) }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteBudgetTemplate(profileId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.budgetTemplates(profileId) }),
  });

  const handleSave = async () => {
    if (!name.trim()) return;
    await insertMutation.mutateAsync({
      name: name.trim(), type,
      revenue_fields: currentFields.revenueFields as unknown,
      cost_fields: currentFields.costFields as unknown,
      result_fields: currentFields.resultFields as unknown,
    });
    toast({ title: "Template saved", description: `"${name}" has been saved for future use.` });
    setName("");
    onOpenChange(false);
  };

  const handleDelete = (id: string) => {
    deleteMutation.mutate(id);
    toast({ title: "Template deleted" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "save" ? "Save as Template" : "Load Template"}</DialogTitle>
        </DialogHeader>

        {mode === "save" ? (
          <div className="space-y-4">
            <div>
              <Label>Template name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Small Club Show, DJ Night..." className="mt-1" />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as BudgetTemplate["type"])}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom</SelectItem>
                  <SelectItem value="venue_default">Venue Default</SelectItem>
                  <SelectItem value="promoter">Promoter Template</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={!name.trim()} className="gap-1.5"><Save className="h-4 w-4" /> Save Template</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-8">Loading templates...</p>
            ) : templates.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No templates saved yet. Save your first budget setup as a template.</p>
            ) : (
              templates.map(t => (
                <div key={t.id} className="flex items-center justify-between rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                  <div className="flex-1 cursor-pointer" onClick={() => { onLoad(t); onOpenChange(false); }}>
                    <p className="text-sm font-medium">{t.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{t.type.replace("_", " ")} · {t.revenueFields.length + t.costFields.length} fields</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { onLoad(t); onOpenChange(false); }}>
                      <FolderOpen className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(t.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
