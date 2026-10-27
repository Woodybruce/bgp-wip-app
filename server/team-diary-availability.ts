/** Free/busy results have no participant evidence and cannot identify meetings. */
export function teamDiaryItems(schedule: any) {
  return (Array.isArray(schedule?.scheduleItems) ? schedule.scheduleItems : [])
    .filter((item: any) => item && item.start?.dateTime && item.end?.dateTime)
    .map((item: any) => {
      const subject = typeof item.subject === "string" ? item.subject.trim() : "";
      const detailsUnavailable = !subject || /^(busy|no subject)$/i.test(subject);
      return {
        status: item.status,
        subject: detailsUnavailable ? "Busy — details unavailable" : subject,
        location: detailsUnavailable ? "" : (item.location || ""),
        start: item.start, end: item.end, isPrivate: item.isPrivate === true,
        detailsUnavailable,
      };
    });
}

export function teamDiaryCoverage(schedules: any[], requested: number, period: string) {
  const checked = schedules.filter(schedule => !schedule.error);
  const items = checked.flatMap(teamDiaryItems).filter(item => item.status !== "free" && item.status !== "unknown");
  const busyBlocks = items.length;
  const detailsUnavailable = !items.length || items.some(item => item.detailsUnavailable);
  const periodLabel = period === "day" ? "today" : period === "month" ? "this month" : "this week";
  const coverageText = checked.length < requested ? ` Availability was returned for ${checked.length} of ${requested} calendars.` : "";
  return {
    source: "free_busy" as const, requested, checked: checked.length, busyBlocks, detailsUnavailable,
    summary: detailsUnavailable
      ? `${busyBlocks ? `Availability shows ${busyBlocks} busy diary block${busyBlocks === 1 ? "" : "s"} ${periodLabel}.` : `No busy diary blocks were returned ${periodLabel}.`} Meeting details are unavailable in this view, so client meetings and shared attendance cannot be confirmed.${coverageText}`
      : "",
  };
}
