import { Input } from "@/components/ui/input";

/**
 * Two-field HH:MM time editor used by the event schedule. The pair of inputs
 * select-all on focus and prevent the trailing mousedown→mouseup from clearing
 * that selection so a single click on the (often-default) "00" minute value
 * leaves it ready for replacement-by-typing.
 */
export function ScheduleTimeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [hh, mm] = value ? value.split(":") : ["", ""];

  return (
    <div className="flex items-center gap-1">
      <Input
        value={hh || ""}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 2);
          onChange(`${v}:${mm || "00"}`);
        }}
        onFocus={(e) => e.currentTarget.select()}
        onMouseUp={(e) => e.preventDefault()}
        placeholder="HH"
        className="w-14 text-center"
        maxLength={2}
        inputMode="numeric"
        aria-label="Hours"
      />
      <span className="text-muted-foreground font-bold">:</span>
      <Input
        value={mm || ""}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 2);
          onChange(`${hh || "00"}:${v}`);
        }}
        onFocus={(e) => e.currentTarget.select()}
        onMouseUp={(e) => e.preventDefault()}
        placeholder="MM"
        className="w-14 text-center"
        maxLength={2}
        inputMode="numeric"
        aria-label="Minutes"
      />
    </div>
  );
}
