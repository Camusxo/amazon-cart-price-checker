import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { ItemStatus } from "../types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number | null, currency: string | null) {
    if (amount === null || !currency) return '-';
    try {
        return new Intl.NumberFormat('ja-JP', { style: 'currency', currency }).format(amount);
    } catch {
        return `${amount} ${currency}`;
    }
}

export const STATUS_COLORS: Record<ItemStatus, string> = {
    [ItemStatus.PENDING]: "bg-slate-100 text-slate-600",
    [ItemStatus.OK]: "bg-green-100 text-green-700 border-green-200",
    [ItemStatus.NO_OFFER]: "bg-yellow-100 text-yellow-800 border-yellow-200",
    [ItemStatus.NOT_FOUND]: "bg-orange-100 text-orange-800 border-orange-200",
    [ItemStatus.THROTTLED]: "bg-red-100 text-red-800 border-red-200",
    [ItemStatus.AUTH_ERROR]: "bg-purple-100 text-purple-800 border-purple-200",
    [ItemStatus.ERROR]: "bg-red-100 text-red-800 border-red-200",
};

export function getStatusColor(status: ItemStatus) {
    return STATUS_COLORS[status] || "bg-gray-100";
}

export function formatProfitRate(rate: number | null): string {
    if (rate === null) return '-';
    return `${rate > 0 ? '+' : ''}${rate}%`;
}
