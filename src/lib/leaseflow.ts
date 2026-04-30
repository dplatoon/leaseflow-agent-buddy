export const STATUSES = ["New", "Contacted", "Scheduled", "Closed", "Lost"] as const;
export type Status = typeof STATUSES[number];

export const SOURCES = ["Vapi Call", "WhatsApp", "Referral", "Walk-in", "Manual"] as const;
export type Source = typeof SOURCES[number];

export const BUDGETS = ["Under 20k", "20k–40k", "40k–60k", "60k–100k", "100k+"] as const;
export const PROPERTY_TYPES = ["1BHK", "2BHK", "3BHK", "Studio", "Duplex", "Commercial"] as const;
export const URGENCIES = ["ASAP", "Within 1 month", "1–3 months", "Flexible"] as const;

export const statusClass: Record<Status, string> = {
  New: "bg-status-new/15 text-status-new border-status-new/30",
  Contacted: "bg-status-contacted/15 text-status-contacted border-status-contacted/30",
  Scheduled: "bg-status-scheduled/15 text-status-scheduled border-status-scheduled/30",
  Closed: "bg-status-closed/15 text-status-closed border-status-closed/30",
  Lost: "bg-status-lost/15 text-status-lost border-status-lost/30",
};

export type Lead = {
  id: string;
  user_id: string;
  full_name: string;
  phone: string | null;
  location: string | null;
  budget: string | null;
  property_type: string | null;
  urgency: string | null;
  source: string;
  status: string;
  notes: string | null;
  created_at: string;
};
