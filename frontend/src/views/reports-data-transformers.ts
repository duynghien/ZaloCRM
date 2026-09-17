export function transformContactReport(raw: any): { label: string; count: number }[] {
  const rows: { label: string; count: number }[] = [];
  const days = Array.isArray(raw?.newPerDay) ? raw.newPerDay : [];
  for (const d of days) {
    rows.push({ label: `Mới ${d.date}`, count: Number(d.count ?? 0) });
  }
  for (const t of (raw?.treatmentProgress ?? [])) {
    rows.push({ label: `Tiến triển: ${t.status}`, count: Number(t.count ?? 0) });
  }
  for (const m of (raw?.medicationStatus ?? [])) {
    rows.push({ label: `Thuốc: ${m.status}`, count: Number(m.count ?? 0) });
  }
  return rows;
}

export function transformAppointmentReport(raw: any): { label: string; count: number }[] {
  const rows: { label: string; count: number }[] = [];
  for (const s of (raw?.byStatus ?? [])) {
    rows.push({ label: `Trạng thái: ${s.status}`, count: Number(s.count ?? 0) });
  }
  for (const t of (raw?.byType ?? [])) {
    rows.push({ label: `Loại: ${t.type ?? '—'}`, count: Number(t.count ?? 0) });
  }
  return rows;
}
