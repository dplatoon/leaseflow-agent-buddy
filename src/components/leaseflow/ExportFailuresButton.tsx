import { useState } from "react";
import { format } from "date-fns";
import { CalendarIcon, Download } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { parseChannelFromNote, parseFailureReason } from "@/lib/templates";
import type { CallLog } from "@/lib/calls";

type Props = {
  /** Optional restriction to specific lead ids (e.g. currently filtered Leads page set). */
  leadIds?: string[];
  /** Button label override. */
  label?: string;
  /** Tooltip / title override. */
  title?: string;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "ghost";
  className?: string;
};

export default function ExportFailuresButton({
  leadIds,
  label = "Export failures CSV",
  title,
  size = "sm",
  variant = "outline",
  className,
}: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState<DateRange | undefined>(undefined);
  const [exporting, setExporting] = useState(false);

  const scoped = Array.isArray(leadIds);
  const scopeEmpty = scoped && leadIds!.length === 0;

  const presetRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);
    setRange({ from, to });
  };

  const runExport = async () => {
    if (!user) return;
    if (scopeEmpty) {
      toast.info("No leads in current view to export.");
      return;
    }
    setExporting(true);
    try {
      // Page through results in chunks so we don't silently hit Supabase's 1000-row cap.
      const PAGE = 1000;
      const failures: CallLog[] = [];
      for (let offset = 0; ; offset += PAGE) {
        let q = supabase
          .from("call_logs" as never)
          .select("*")
          .eq("outcome", "message_failed")
          .order("created_at", { ascending: false })
          .range(offset, offset + PAGE - 1);
        if (range?.from) {
          const from = new Date(range.from);
          from.setHours(0, 0, 0, 0);
          q = q.gte("created_at", from.toISOString());
        }
        if (range?.to) {
          const to = new Date(range.to);
          to.setHours(23, 59, 59, 999);
          q = q.lte("created_at", to.toISOString());
        }
        if (scoped) q = q.in("lead_id", leadIds!);
        const { data, error } = await q;
        if (error) throw error;
        const chunk = (data ?? []) as unknown as CallLog[];
        failures.push(...chunk);
        if (chunk.length < PAGE) break;
      }
      if (failures.length === 0) {
        toast.info("No failed messages match the selected filters.");
        return;
      }

      const uniqueLeadIds = [...new Set(failures.map((f) => f.lead_id))];
      const { data: leadRows } = await supabase
        .from("leads")
        .select("id, full_name, phone, location")
        .in("id", uniqueLeadIds);
      const leadById = new Map<string, { full_name: string; phone: string | null; location: string | null }>(
        (leadRows ?? []).map((l) => [
          l.id as string,
          l as { full_name: string; phone: string | null; location: string | null },
        ]),
      );

      const headers = [
        "timestamp_iso",
        "timestamp_local",
        "lead_name",
        "lead_phone",
        "lead_location",
        "channel",
        "failure_reason",
        "notes",
      ];
      const escape = (val: unknown) => {
        const s = val === null || val === undefined ? "" : String(val);
        return `"${s.replace(/"/g, '""')}"`;
      };
      const rows = failures.map((f) => {
        const lead = leadById.get(f.lead_id);
        return [
          f.created_at,
          format(new Date(f.created_at), "yyyy-MM-dd HH:mm:ss"),
          lead?.full_name ?? "",
          lead?.phone ?? "",
          lead?.location ?? "",
          parseChannelFromNote(f.notes),
          parseFailureReason(f.notes),
          (f.notes ?? "").replace(/\r?\n/g, " ⏎ "),
        ]
          .map(escape)
          .join(",");
      });
      const csv = [headers.join(","), ...rows].join("\n");
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const rangeTag =
        range?.from && range?.to
          ? `${format(range.from, "yyyyMMdd")}-${format(range.to, "yyyyMMdd")}`
          : range?.from
            ? `from-${format(range.from, "yyyyMMdd")}`
            : "all";
      a.download = `message-failures-${rangeTag}-${format(new Date(), "HHmmss")}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${failures.length} failed message${failures.length === 1 ? "" : "s"}`);
      setOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const rangeLabel =
    range?.from && range?.to
      ? `${format(range.from, "MMM d")} – ${format(range.to, "MMM d, yyyy")}`
      : range?.from
        ? `From ${format(range.from, "MMM d, yyyy")}`
        : "All time";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size={size}
          variant={variant}
          className={cn("gap-1.5", className)}
          title={title ?? "Download failed message attempts as CSV"}
          disabled={scopeEmpty}
        >
          <Download className="h-3.5 w-3.5" />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3 space-y-3" align="end">
        <div className="space-y-1">
          <div className="text-xs font-medium">Date range</div>
          <div className="text-[11px] text-muted-foreground">{rangeLabel}</div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => presetRange(7)}>Last 7d</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => presetRange(30)}>Last 30d</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => presetRange(90)}>Last 90d</Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRange(undefined)}>All time</Button>
        </div>
        <Calendar
          mode="range"
          selected={range}
          onSelect={setRange}
          numberOfMonths={1}
          className={cn("p-0 pointer-events-auto")}
        />
        <div className="flex items-center justify-between gap-2 pt-1 border-t border-border">
          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <CalendarIcon className="h-3 w-3" />
            {scoped ? `${leadIds!.length} lead${leadIds!.length === 1 ? "" : "s"} in scope` : "All your leads"}
          </span>
          <Button size="sm" onClick={runExport} disabled={exporting} className="gap-1.5">
            <Download className="h-3.5 w-3.5" />
            {exporting ? "Exporting…" : "Download CSV"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}