// One rule for "is this task late", shared by every reader of
// user_tasks.due_date.
//
// due_date is a TIMESTAMP but every door that WRITES it writes a day, not a
// moment: the ChatBGP create_task schema asks the model for "YYYY-MM-DD",
// and no surface in the app ever renders the time-of-day. So a task due
// today is due today — it only goes overdue once that day has passed.
// `new Date(due) < new Date()` made every date-only due date read as overdue
// from 00:00 on the day itself.
import { isDayOverdue } from "./day-overdue";

export function isTaskOverdue(dueDate: string | Date | null | undefined): boolean {
  return isDayOverdue(dueDate);
}
