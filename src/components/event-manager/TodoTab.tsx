import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { toast, copyToast } from "@/hooks/use-toast";
import { insertShareTokenRow, type EventMeta } from "@/lib/db";
import { type Event as AppEvent } from "@/lib/models";
import {
  ListTodo, Plus, ChevronDown, Calendar, PenLine, Clock,
  Download, FileText, Share2, Check, Copy, Send, CheckCircle2,
  Trash2, Bell, AlarmClock, DollarSign, X, User,
} from "lucide-react";

/* ─── To Do Tab ─── */
export interface TodoReminder {
  id: string;
  date: string;
  time: string;
  label?: string;
}

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  dueDate?: string;
  completed: boolean;
  completedAt?: string;
  reminders: TodoReminder[];
  createdAt: string;
  budgetType?: "cost" | "revenue";
  budgetAmount?: number;
  assignee?: string;
}

export function TodoTab({ eventMeta, event, onSave, teamMemberNames = [] }: {
  eventMeta: EventMeta;
  event: AppEvent;
  onSave: (d: Partial<EventMeta>) => void;
  teamMemberNames?: string[];
}) {
  const [todos, setTodos] = useState<TodoItem[]>(eventMeta?.todos || []);
  const prevMetaTodosRef = useRef(eventMeta?.todos);

  // Re-sync local state when the upstream eventMeta.todos changes (e.g. after fetch)
  useEffect(() => {
    const incoming = eventMeta?.todos;
    if (incoming && incoming !== prevMetaTodosRef.current) {
      prevMetaTodosRef.current = incoming;
      setTodos(incoming);
    }
  }, [eventMeta?.todos]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDueDate, setNewDueDate] = useState<Date | undefined>();
  const [newDescription, setNewDescription] = useState("");
  const [newBudgetType, setNewBudgetType] = useState<"none" | "cost" | "revenue">("none");
  const [newBudgetAmount, setNewBudgetAmount] = useState("");
  const [newAssignee, setNewAssignee] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [reminderOpenId, setReminderOpenId] = useState<string | null>(null);
  const [reminderDate, setReminderDate] = useState<Date | undefined>();
  const [reminderTime, setReminderTime] = useState("09:00");
  const [reminderLabel, setReminderLabel] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareEmail, setShareEmail] = useState("");
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const save = (updated: TodoItem[]) => {
    setTodos(updated);
    onSave({ todos: updated });
  };

  const addTask = () => {
    if (!newTitle.trim()) return;
    const item: TodoItem = {
      id: crypto.randomUUID(),
      title: newTitle.trim(),
      description: newDescription.trim() || undefined,
      dueDate: newDueDate ? newDueDate.toISOString().slice(0, 10) : undefined,
      completed: false,
      reminders: [],
      createdAt: new Date().toISOString(),
      budgetType: newBudgetType !== "none" ? newBudgetType : undefined,
      budgetAmount: newBudgetType !== "none" && parseFloat(newBudgetAmount) > 0 ? parseFloat(newBudgetAmount) : undefined,
      assignee: newAssignee.trim() || undefined,
    };
    save([...todos, item]);
    setNewTitle("");
    setNewDueDate(undefined);
    setNewDescription("");
    setNewBudgetType("none");
    setNewBudgetAmount("");
    setNewAssignee("");
    setShowAddForm(false);
  };

  const toggleComplete = (id: string) => {
    save(todos.map(t => t.id === id ? { ...t, completed: !t.completed, completedAt: !t.completed ? new Date().toISOString() : undefined } : t));
  };

  const deleteTask = (id: string) => {
    save(todos.filter(t => t.id !== id));
    setDeleteConfirmId(null);
  };

  const startEdit = (t: TodoItem) => { setEditingId(t.id); setEditTitle(t.title); };
  const saveEdit = (id: string) => {
    if (!editTitle.trim()) return;
    save(todos.map(t => t.id === id ? { ...t, title: editTitle.trim() } : t));
    setEditingId(null);
  };

  const updateDueDate = (id: string, date: Date | undefined) => {
    save(todos.map(t => t.id === id ? { ...t, dueDate: date ? date.toISOString().slice(0, 10) : undefined } : t));
  };

  const updateDescription = (id: string, desc: string) => {
    save(todos.map(t => t.id === id ? { ...t, description: desc } : t));
  };

  const addReminder = (todoId: string) => {
    if (!reminderDate) return;
    const r: TodoReminder = { id: crypto.randomUUID(), date: reminderDate.toISOString().slice(0, 10), time: reminderTime, label: reminderLabel.trim() || undefined };
    save(todos.map(t => t.id === todoId ? { ...t, reminders: [...t.reminders, r] } : t));
    setReminderOpenId(null);
    setReminderDate(undefined);
    setReminderTime("09:00");
    setReminderLabel("");
  };

  const removeReminder = (todoId: string, reminderId: string) => {
    save(todos.map(t => t.id === todoId ? { ...t, reminders: t.reminders.filter(r => r.id !== reminderId) } : t));
  };

  const updateBudget = (id: string, budgetType?: "cost" | "revenue", budgetAmount?: number) => {
    save(todos.map(t => t.id === id ? { ...t, budgetType, budgetAmount } : t));
  };

  const updateAssignee = (id: string, assignee?: string) => {
    save(todos.map(t => t.id === id ? { ...t, assignee } : t));
  };

  const activeTodos = todos.filter(t => !t.completed).sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
  const completedTodos = todos.filter(t => t.completed);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-primary" />
          <h2 className="font-display text-lg font-semibold">To Do</h2>
          <Badge variant="secondary" className="ml-2">{activeTodos.length} active</Badge>
        </div>
        <Button size="sm" className="gap-1" onClick={() => setShowAddForm(true)}>
          <Plus className="h-4 w-4" /> Add Task
        </Button>
      </div>

      {/* Add Task Form */}
      {showAddForm && (
        <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
          <Input placeholder="Task title..." value={newTitle} onChange={e => setNewTitle(e.target.value)} autoFocus onKeyDown={e => e.key === "Enter" && addTask()} />
          <div className="flex items-center gap-3">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className={cn("gap-1 text-xs", !newDueDate && "text-muted-foreground")}>
                  <Calendar className="h-3.5 w-3.5" />
                  {newDueDate ? newDueDate.toLocaleDateString() : "Due date"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarPicker mode="single" selected={newDueDate} onSelect={setNewDueDate} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => setNewDescription(prev => prev ? "" : " ")}>
              <PenLine className="h-3.5 w-3.5 mr-1" /> {newDescription ? "Remove" : "Add"} description
            </Button>
          </div>
          {newDescription !== "" && (
            <Textarea placeholder="Description..." value={newDescription} onChange={e => setNewDescription(e.target.value)} className="min-h-[60px] text-sm" />
          )}
          <div className="flex items-center gap-3">
            <Select value={newBudgetType} onValueChange={(v: "none" | "cost" | "revenue") => setNewBudgetType(v)}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No budget</SelectItem>
                <SelectItem value="cost">Cost</SelectItem>
                <SelectItem value="revenue">Revenue</SelectItem>
              </SelectContent>
            </Select>
            {newBudgetType !== "none" && (
              <Input type="number" placeholder="Amount" value={newBudgetAmount} onChange={e => setNewBudgetAmount(e.target.value)} className="h-8 w-[120px] text-xs" />
            )}
          </div>
          <div className="relative">
            <User className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              list="assignee-suggestions"
              placeholder="Assign to… (optional)"
              value={newAssignee}
              onChange={e => setNewAssignee(e.target.value)}
              className="w-full pl-8 pr-3 h-8 rounded-md border bg-background text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {teamMemberNames.length > 0 && (
              <datalist id="assignee-suggestions">
                {teamMemberNames.map(n => <option key={n} value={n} />)}
              </datalist>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setShowAddForm(false); setNewTitle(""); setNewDueDate(undefined); setNewDescription(""); setNewBudgetType("none"); setNewBudgetAmount(""); setNewAssignee(""); }}>Cancel</Button>
            <Button size="sm" onClick={addTask} disabled={!newTitle.trim()}>Add Task</Button>
          </div>
        </div>
      )}

      {/* Empty state */}
      {todos.length === 0 && !showAddForm && (
        <div className="rounded-xl border bg-card p-12 text-center">
          <ListTodo className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-display text-base font-semibold mb-1">No tasks yet</h3>
          <p className="text-sm text-muted-foreground">Create your first task to start tracking.</p>
        </div>
      )}

      {/* Active tasks */}
      <div className="space-y-2">
        {activeTodos.map(todo => (
          <TodoCard key={todo.id} todo={todo} editingId={editingId} editTitle={editTitle} setEditTitle={setEditTitle}
            onToggle={() => toggleComplete(todo.id)} onStartEdit={() => startEdit(todo)} onSaveEdit={() => saveEdit(todo.id)}
            onCancelEdit={() => setEditingId(null)} onDelete={() => setDeleteConfirmId(todo.id)}
            onDueDateChange={d => updateDueDate(todo.id, d)} onDescriptionChange={d => updateDescription(todo.id, d)}
            onBudgetChange={(bt, ba) => updateBudget(todo.id, bt, ba)}
            onAssigneeChange={a => updateAssignee(todo.id, a)}
            reminderOpenId={reminderOpenId} setReminderOpenId={setReminderOpenId}
            reminderDate={reminderDate} setReminderDate={setReminderDate}
            reminderTime={reminderTime} setReminderTime={setReminderTime}
            reminderLabel={reminderLabel} setReminderLabel={setReminderLabel}
            onAddReminder={() => addReminder(todo.id)} onRemoveReminder={(rid) => removeReminder(todo.id, rid)}
            teamMemberNames={teamMemberNames}
          />
        ))}
      </div>

      {/* Completed tasks */}
      {completedTodos.length > 0 && (
        <div>
          <button onClick={() => setShowCompleted(!showCompleted)} className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ChevronDown className={cn("h-4 w-4 transition-transform", !showCompleted && "-rotate-90")} />
            Completed ({completedTodos.length})
          </button>
          {showCompleted && (
            <div className="space-y-2">
              {completedTodos.map(todo => (
                <TodoCard key={todo.id} todo={todo} editingId={editingId} editTitle={editTitle} setEditTitle={setEditTitle}
                  onToggle={() => toggleComplete(todo.id)} onStartEdit={() => startEdit(todo)} onSaveEdit={() => saveEdit(todo.id)}
                  onCancelEdit={() => setEditingId(null)} onDelete={() => setDeleteConfirmId(todo.id)}
                  onDueDateChange={d => updateDueDate(todo.id, d)} onDescriptionChange={d => updateDescription(todo.id, d)}
                  onBudgetChange={(bt, ba) => updateBudget(todo.id, bt, ba)}
                  reminderOpenId={reminderOpenId} setReminderOpenId={setReminderOpenId}
                  reminderDate={reminderDate} setReminderDate={setReminderDate}
                  reminderTime={reminderTime} setReminderTime={setReminderTime}
                  reminderLabel={reminderLabel} setReminderLabel={setReminderLabel}
                  onAddReminder={() => addReminder(todo.id)} onRemoveReminder={(rid) => removeReminder(todo.id, rid)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Task Schedule */}
      {todos.length > 0 && (
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center justify-between px-5 py-3 border-b">
            <h3 className="text-sm font-semibold flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Task Schedule</h3>
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => {
                const sorted = [...todos].sort((a, b) => { if (!a.dueDate && !b.dueDate) return 0; if (!a.dueDate) return 1; if (!b.dueDate) return -1; return a.dueDate.localeCompare(b.dueDate); });
                const rows = [["Task","Due Date","Status","Reminders","Budget Type","Budget Amount","Description"].join(",")];
                sorted.forEach(t => {
                  rows.push([`"${t.title}"`, t.dueDate || "", t.completed ? "Done" : (t.dueDate && new Date(t.dueDate) < new Date(new Date().toISOString().slice(0,10)) ? "Overdue" : "Pending"),
                    `"${t.reminders.map(r => `${r.date} ${r.time}${r.label ? ` (${r.label})` : ""}`).join("; ")}"`,
                    t.budgetType || "", t.budgetAmount ? String(t.budgetAmount) : "", `"${(t.description || "").replace(/"/g, '""')}"`
                  ].join(","));
                });
                const blob = new Blob([rows.join("\n")], { type: "text/csv" }); const url = URL.createObjectURL(blob);
                const a = document.createElement("a"); a.href = url; a.download = `tasks-${event.name.replace(/\s+/g, "_")}.csv`; a.click(); URL.revokeObjectURL(url);
                toast({ title: "CSV downloaded" });
              }}>
                <Download className="h-3 w-3" /> CSV
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => {
                import("jspdf").then(({ default: jsPDF }) => {
                  import("jspdf-autotable").then(({ default: autoTable }) => {
                    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
                    const pw = doc.internal.pageSize.getWidth(); const mg = 14; let y = 16;
                    doc.setFillColor(30, 30, 40); doc.rect(0, 0, pw, 36, "F");
                    doc.setTextColor(255, 255, 255); doc.setFontSize(16); doc.setFont("helvetica", "bold");
                    doc.text("Task Schedule", mg, y + 4); doc.setFontSize(9); doc.setFont("helvetica", "normal");
                    doc.text(`${event.name}  •  ${event.venue}  •  ${event.date}`, mg, y + 12);
                    doc.setFontSize(7); doc.text(`Generated ${new Date().toLocaleDateString()}`, mg, y + 18); y = 44;
                    const overdue = todos.filter(t => !t.completed && t.dueDate && new Date(t.dueDate) < new Date(new Date().toISOString().slice(0,10))).length;
                    const totalBudget = todos.filter(t => t.budgetAmount).reduce((s, t) => s + (t.budgetAmount || 0), 0);
                    const cardW = (pw - mg * 2 - 12) / 3;
                    [{ l: "Total Tasks", v: String(todos.length), c: [59, 130, 246] as [number,number,number] },
                     { l: "Completed", v: `${completedTodos.length}/${todos.length}`, c: [34, 197, 94] as [number,number,number] },
                     { l: "Overdue", v: String(overdue), c: overdue > 0 ? [239, 68, 68] as [number,number,number] : [107, 114, 128] as [number,number,number] }
                    ].forEach((card, i) => {
                      const x = mg + i * (cardW + 6);
                      doc.setFillColor(card.c[0], card.c[1], card.c[2]); doc.roundedRect(x, y, cardW, 18, 2, 2, "F");
                      doc.setTextColor(255, 255, 255); doc.setFontSize(7); doc.setFont("helvetica", "normal"); doc.text(card.l, x + 4, y + 7);
                      doc.setFontSize(12); doc.setFont("helvetica", "bold"); doc.text(card.v, x + 4, y + 14);
                    });
                    y += 26;
                    const sorted = [...todos].sort((a, b) => { if (!a.dueDate && !b.dueDate) return 0; if (!a.dueDate) return 1; if (!b.dueDate) return -1; return a.dueDate.localeCompare(b.dueDate); });
                    autoTable(doc, {
                      startY: y, head: [["Task", "Due Date", "Status", "Reminders", "Budget"]],
                      body: sorted.map(t => [
                        t.title, t.dueDate || "—",
                        t.completed ? "✓ Done" : (t.dueDate && new Date(t.dueDate) < new Date(new Date().toISOString().slice(0,10)) ? "⚠ Overdue" : "Pending"),
                        t.reminders.map(r => `${r.date} ${r.time}`).join("\n") || "—",
                        t.budgetType ? `${t.budgetType === "cost" ? "Cost" : "Rev."} €${(t.budgetAmount || 0).toLocaleString()}` : "—"
                      ]),
                      margin: { left: mg, right: mg }, styles: { fontSize: 7.5, cellPadding: 2 },
                      headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: "bold" },
                      alternateRowStyles: { fillColor: [245, 247, 255] }, theme: "grid",
                    });
                    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
                    if (totalBudget > 0) {
                      doc.setFontSize(8); doc.setTextColor(100, 100, 100);
                      doc.text(`Total budget items: €${totalBudget.toLocaleString()}`, mg, y);
                    }
                    const pc = doc.getNumberOfPages();
                    for (let p = 1; p <= pc; p++) { doc.setPage(p); doc.setFontSize(7); doc.setTextColor(160, 160, 160); doc.text(`Page ${p} of ${pc}`, pw / 2, 290, { align: "center" }); }
                    doc.save(`tasks-${event.name.replace(/\s+/g, "_")}-${new Date().toISOString().slice(0, 10)}.pdf`);
                    toast({ title: "PDF downloaded" });
                  });
                });
              }}>
                <FileText className="h-3 w-3" /> PDF
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1"><Share2 className="h-3 w-3" /> Share</Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-3" align="end">
                  <div className="space-y-3">
                    <div>
                      <p className="text-sm font-medium mb-1">Share Task Schedule</p>
                      <p className="text-xs text-muted-foreground">Generate a shareable link with a snapshot of these tasks.</p>
                    </div>
                    {shareUrl ? (
                      <>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-0 rounded-md border bg-muted/50 px-2 py-1.5">
                            <p className="text-xs truncate text-muted-foreground">{shareUrl}</p>
                          </div>
                          <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={async () => {
                            await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000);
                            copyToast("Copied!");
                          }}>
                            {copied ? <Check className="h-3.5 w-3.5 text-[hsl(var(--success))]" /> : <Copy className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input placeholder="Email address" value={shareEmail} onChange={e => setShareEmail(e.target.value)} className="h-8 text-xs" />
                          <Button size="sm" className="h-8 text-xs gap-1 shrink-0" disabled={!shareEmail.trim()} onClick={() => {
                            const subject = encodeURIComponent(`Task Schedule: ${event.name}`);
                            const body = encodeURIComponent(`Here's the task schedule for ${event.name}:\n\n${shareUrl}`);
                            window.open(`mailto:${shareEmail}?subject=${subject}&body=${body}`);
                            toast({ title: "Email client opened" });
                          }}>
                            <Send className="h-3 w-3" /> Email
                          </Button>
                        </div>
                      </>
                    ) : (
                      <Button size="sm" className="w-full gap-1.5 text-xs" disabled={generating} onClick={async () => {
                        setGenerating(true);
                        try {
                          const token = crypto.randomUUID();
                          const shareData = { type: "todo-schedule", eventName: event.name, eventVenue: event.venue, eventDate: event.date, todos: todos.map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate, completed: t.completed, reminders: t.reminders, budgetType: t.budgetType, budgetAmount: t.budgetAmount, description: t.description })), generatedAt: new Date().toISOString() };
                          await insertShareTokenRow({ token, event_id: event.id, parties: shareData as unknown });
                          const url = `${window.location.origin}/shared/budget/${token}`;
                          setShareUrl(url); await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000);
                          copyToast("Share link copied!");
                        } catch (err) { console.error(err); toast({ title: "Failed to generate share link", variant: "destructive" }); }
                        finally { setGenerating(false); }
                      }}>
                        <Share2 className="h-3.5 w-3.5" /> {generating ? "Generating..." : "Generate Share Link"}
                      </Button>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Task</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Due Date</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Status</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Reminders</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Budget</th>
                </tr>
              </thead>
              <tbody>
                {[...todos].sort((a, b) => { if (!a.dueDate && !b.dueDate) return 0; if (!a.dueDate) return 1; if (!b.dueDate) return -1; return a.dueDate.localeCompare(b.dueDate); }).map(t => {
                  const isOverdue = t.dueDate && !t.completed && new Date(t.dueDate) < new Date(new Date().toISOString().slice(0, 10));
                  return (
                    <tr key={t.id} className={cn("border-b last:border-0", t.completed && "opacity-50")}>
                      <td className={cn("px-4 py-2.5", t.completed && "line-through text-muted-foreground")}>{t.title}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{t.dueDate ? new Date(t.dueDate + "T00:00:00").toLocaleDateString() : "—"}</td>
                      <td className="px-4 py-2.5">
                        {t.completed ? (
                          <span className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 bg-primary/10 text-primary"><CheckCircle2 className="h-3 w-3" /> Done</span>
                        ) : isOverdue ? (
                          <span className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 bg-destructive/10 text-destructive">Overdue</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 bg-muted text-muted-foreground">Pending</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">
                        {t.reminders.length > 0 ? t.reminders.map(r => `${new Date(r.date + "T00:00:00").toLocaleDateString()} ${r.time}`).join(", ") : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        {t.budgetType && t.budgetAmount ? (
                          <span className={cn("text-xs font-medium", t.budgetType === "cost" ? "text-destructive" : "text-primary")}>
                            {t.budgetType === "cost" ? "Cost" : "Revenue"}: €{t.budgetAmount.toLocaleString()}
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={v => !v && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>Are you sure you want to delete this task? This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirmId && deleteTask(deleteConfirmId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function TodoCard({ todo, editingId, editTitle, setEditTitle, onToggle, onStartEdit, onSaveEdit, onCancelEdit, onDelete, onDueDateChange, onDescriptionChange, onBudgetChange, onAssigneeChange, reminderOpenId, setReminderOpenId, reminderDate, setReminderDate, reminderTime, setReminderTime, reminderLabel, setReminderLabel, onAddReminder, onRemoveReminder, teamMemberNames = [] }: {
  todo: TodoItem; editingId: string | null; editTitle: string; setEditTitle: (v: string) => void;
  onToggle: () => void; onStartEdit: () => void; onSaveEdit: () => void; onCancelEdit: () => void; onDelete: () => void;
  onDueDateChange: (d: Date | undefined) => void; onDescriptionChange: (d: string) => void;
  onBudgetChange: (type?: "cost" | "revenue", amount?: number) => void;
  onAssigneeChange: (assignee?: string) => void;
  reminderOpenId: string | null; setReminderOpenId: (v: string | null) => void;
  reminderDate: Date | undefined; setReminderDate: (v: Date | undefined) => void;
  reminderTime: string; setReminderTime: (v: string) => void;
  reminderLabel: string; setReminderLabel: (v: string) => void;
  onAddReminder: () => void; onRemoveReminder: (id: string) => void;
  teamMemberNames?: string[];
}) {
  const [showDesc, setShowDesc] = useState(false);
  const [showBudgetEdit, setShowBudgetEdit] = useState(false);
  const [editBudgetType, setEditBudgetType] = useState<"none" | "cost" | "revenue">(todo.budgetType || "none");
  const [editBudgetAmount, setEditBudgetAmount] = useState(String(todo.budgetAmount || ""));
  const [showAssigneeEdit, setShowAssigneeEdit] = useState(false);
  const [editAssignee, setEditAssignee] = useState(todo.assignee || "");
  const isEditing = editingId === todo.id;
  const isOverdue = todo.dueDate && !todo.completed && new Date(todo.dueDate) < new Date(new Date().toISOString().slice(0, 10));

  return (
    <div className={cn("rounded-lg border bg-card p-3 shadow-sm transition-colors", todo.completed && "opacity-60")}>
      <div className="flex items-start gap-3">
        <Checkbox checked={todo.completed} onCheckedChange={onToggle} className="mt-0.5" />
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Input value={editTitle} onChange={e => setEditTitle(e.target.value)} className="h-7 text-sm" autoFocus onKeyDown={e => { if (e.key === "Enter") onSaveEdit(); if (e.key === "Escape") onCancelEdit(); }} />
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onSaveEdit}><Check className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onCancelEdit}><X className="h-3.5 w-3.5" /></Button>
            </div>
          ) : (
            <p className={cn("text-sm font-medium cursor-pointer hover:text-primary", todo.completed && "line-through text-muted-foreground")} onClick={onStartEdit}>
              {todo.title}
            </p>
          )}

          {/* Budget badge */}
          {todo.budgetType && todo.budgetAmount && (
            <button onClick={() => setShowBudgetEdit(!showBudgetEdit)} className={cn("inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5 mt-0.5 cursor-pointer hover:opacity-80", todo.budgetType === "cost" ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-600")}>
              <DollarSign className="h-3 w-3" />
              {todo.budgetType === "cost" ? "Cost" : "Revenue"}: €{todo.budgetAmount.toLocaleString()}
            </button>
          )}
          {!todo.budgetType && !todo.completed && (
            <button onClick={() => setShowBudgetEdit(!showBudgetEdit)} className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-foreground mt-0.5">
              <DollarSign className="h-3 w-3" /> Add budget
            </button>
          )}

          {/* Budget inline edit */}
          {showBudgetEdit && (
            <div className="flex items-center gap-2 mt-1">
              <Select value={editBudgetType} onValueChange={(v: "none" | "cost" | "revenue") => setEditBudgetType(v)}>
                <SelectTrigger className="h-7 w-[110px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No budget</SelectItem>
                  <SelectItem value="cost">Cost</SelectItem>
                  <SelectItem value="revenue">Revenue</SelectItem>
                </SelectContent>
              </Select>
              {editBudgetType !== "none" && (
                <Input type="number" placeholder="Amount" value={editBudgetAmount} onChange={e => setEditBudgetAmount(e.target.value)} className="h-7 w-[100px] text-xs" />
              )}
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => {
                onBudgetChange(
                  editBudgetType !== "none" ? editBudgetType : undefined,
                  editBudgetType !== "none" && parseFloat(editBudgetAmount) > 0 ? parseFloat(editBudgetAmount) : undefined
                );
                setShowBudgetEdit(false);
              }}><Check className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setShowBudgetEdit(false); setEditBudgetType(todo.budgetType || "none"); setEditBudgetAmount(String(todo.budgetAmount || "")); }}><X className="h-3.5 w-3.5" /></Button>
            </div>
          )}

          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {/* Due date */}
            <Popover>
              <PopoverTrigger asChild>
                <button className={cn("inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 hover:bg-accent", isOverdue ? "text-destructive bg-destructive/10" : todo.dueDate ? "text-muted-foreground" : "text-muted-foreground/60")}>
                  <Calendar className="h-3 w-3" />
                  {todo.dueDate ? new Date(todo.dueDate + "T00:00:00").toLocaleDateString() : "No date"}
                  {isOverdue && <span className="font-medium ml-0.5">Overdue</span>}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarPicker mode="single" selected={todo.dueDate ? new Date(todo.dueDate + "T00:00:00") : undefined} onSelect={onDueDateChange} className="p-3 pointer-events-auto" />
              </PopoverContent>
            </Popover>

            {/* Reminders */}
            {todo.reminders.map(r => (
              <span key={r.id} className="inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 bg-accent text-accent-foreground">
                <AlarmClock className="h-3 w-3" />
                {new Date(r.date + "T00:00:00").toLocaleDateString()} {r.time}
                {r.label && <span>· {r.label}</span>}
                <button onClick={() => onRemoveReminder(r.id)} className="ml-0.5 hover:text-destructive"><X className="h-3 w-3" /></button>
              </span>
            ))}

            {/* Add reminder */}
            <Popover open={reminderOpenId === todo.id} onOpenChange={v => { setReminderOpenId(v ? todo.id : null); if (!v) { setReminderDate(undefined); setReminderTime("09:00"); setReminderLabel(""); } }}>
              <PopoverTrigger asChild>
                <button className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-foreground rounded px-1.5 py-0.5 hover:bg-accent">
                  <Bell className="h-3 w-3" /> Add reminder
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3 space-y-3" align="start">
                <p className="text-xs font-medium">New Reminder</p>
                <CalendarPicker mode="single" selected={reminderDate} onSelect={setReminderDate} className="p-2 pointer-events-auto" />
                <div className="flex items-center gap-2">
                  <Label className="text-xs w-10">Time</Label>
                  <Input type="time" value={reminderTime} onChange={e => setReminderTime(e.target.value)} className="h-8 text-xs flex-1" />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs w-10">Label</Label>
                  <Input placeholder="e.g. 1 day before" value={reminderLabel} onChange={e => setReminderLabel(e.target.value)} className="h-8 text-xs flex-1" />
                </div>
                <Button size="sm" className="w-full" disabled={!reminderDate} onClick={onAddReminder}>Add Reminder</Button>
              </PopoverContent>
            </Popover>

            {/* Assignee */}
            {todo.assignee && !showAssigneeEdit && (
              <button onClick={() => { setShowAssigneeEdit(true); setEditAssignee(todo.assignee || ""); }} className="inline-flex items-center gap-1 text-xs rounded px-1.5 py-0.5 bg-accent text-accent-foreground hover:opacity-80">
                <User className="h-3 w-3" /> {todo.assignee}
              </button>
            )}
            {!todo.assignee && !todo.completed && !showAssigneeEdit && (
              <button onClick={() => setShowAssigneeEdit(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-foreground rounded px-1.5 py-0.5 hover:bg-accent">
                <User className="h-3 w-3" /> Assign
              </button>
            )}
            {showAssigneeEdit && (
              <div className="flex items-center gap-1">
                <div className="relative">
                  <input
                    list={`assignee-list-${todo.id}`}
                    placeholder="Name…"
                    value={editAssignee}
                    onChange={e => setEditAssignee(e.target.value)}
                    className="h-6 w-28 rounded border px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring bg-background"
                    autoFocus
                    onKeyDown={e => {
                      if (e.key === "Enter") { onAssigneeChange(editAssignee.trim() || undefined); setShowAssigneeEdit(false); }
                      if (e.key === "Escape") setShowAssigneeEdit(false);
                    }}
                  />
                  {teamMemberNames.length > 0 && (
                    <datalist id={`assignee-list-${todo.id}`}>
                      {teamMemberNames.map(n => <option key={n} value={n} />)}
                    </datalist>
                  )}
                </div>
                <button onClick={() => { onAssigneeChange(editAssignee.trim() || undefined); setShowAssigneeEdit(false); }} className="text-xs text-primary hover:opacity-80"><Check className="h-3 w-3" /></button>
                <button onClick={() => setShowAssigneeEdit(false)} className="text-xs text-muted-foreground hover:opacity-80"><X className="h-3 w-3" /></button>
              </div>
            )}

            {/* Description toggle */}
            {(todo.description || !todo.completed) && (
              <button onClick={() => setShowDesc(!showDesc)} className="inline-flex items-center gap-1 text-xs text-muted-foreground/60 hover:text-foreground rounded px-1.5 py-0.5 hover:bg-accent">
                <PenLine className="h-3 w-3" /> {todo.description ? "Note" : "Add note"}
              </button>
            )}
          </div>

          {/* Description */}
          {showDesc && (
            <Textarea value={todo.description || ""} onChange={e => onDescriptionChange(e.target.value)} placeholder="Add a note..." className="mt-2 min-h-[50px] text-xs" />
          )}
        </div>

        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
