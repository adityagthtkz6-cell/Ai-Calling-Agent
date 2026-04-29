import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(seconds: number | null): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function formatCost(usd: number | null): string {
  if (usd === null || usd === undefined) return "—";
  if (usd < 0.01) return `$${(usd * 100).toFixed(3)}¢`;
  return `$${usd.toFixed(4)}`;
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString();
}

export const OUTCOME_LABEL: Record<string, { label: string; color: string }> = {
  qualified:  { label: "Qualified",  color: "text-green-400" },
  booked:     { label: "Booked",     color: "text-blue-400" },
  voicemail:  { label: "Voicemail",  color: "text-yellow-400" },
  spam:       { label: "Spam",       color: "text-red-400" },
  hung_up:    { label: "Hung Up",    color: "text-zinc-400" },
  transferred:{ label: "Transferred",color: "text-purple-400" },
};

export const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  new:         { label: "New",         color: "text-zinc-300" },
  qualified:   { label: "Qualified",   color: "text-green-400" },
  booked:      { label: "Booked",      color: "text-blue-400" },
  followed_up: { label: "Followed Up", color: "text-sky-400" },
  closed:      { label: "Closed",      color: "text-zinc-500" },
  spam:        { label: "Spam",        color: "text-red-400" },
};
