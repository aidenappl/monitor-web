export function exportToCSV(data: Record<string, unknown>[], filename: string): void {
    if (data.length === 0) return;

    const headers = Array.from(
        data.reduce<Set<string>>((keys, row) => {
            Object.keys(row).forEach((k) => keys.add(k));
            return keys;
        }, new Set())
    );

    const escapeCSV = (value: unknown): string => {
        if (value === null || value === undefined) return "";
        const str = typeof value === "object" ? JSON.stringify(value) : String(value);
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const lines = [
        headers.join(","),
        ...data.map((row) => headers.map((h) => escapeCSV(row[h])).join(",")),
    ];

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    triggerDownload(blob, filename.endsWith(".csv") ? filename : `${filename}.csv`);
}

export function exportToJSON(data: Record<string, unknown>[], filename: string): void {
    if (data.length === 0) return;

    const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json;charset=utf-8;",
    });
    triggerDownload(blob, filename.endsWith(".json") ? filename : `${filename}.json`);
}

function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}
