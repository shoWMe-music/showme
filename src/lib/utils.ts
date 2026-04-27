import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export async function generateSignatureHash(party: string, timestamp: string, confirmedBy: string): Promise<string> {
  const data = `${party}|${timestamp}|${confirmedBy}`;
  const encoded = new TextEncoder().encode(data);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
