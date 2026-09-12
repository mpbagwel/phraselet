export const BACKUP_REMINDER_CARD_COUNT = 10;
export const BACKUP_REMINDER_DAYS = 30;
export const BACKUP_SNOOZE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function shouldShowBackupReminder(cards, reminder = {}, now = new Date()) {
  if (!Array.isArray(cards) || cards.length < BACKUP_REMINDER_CARD_COUNT) {
    return false;
  }

  const nowMs = validTimestamp(now);
  if (nowMs === null) {
    return false;
  }

  const snoozedUntil = validTimestamp(reminder.snoozedUntil);
  if (snoozedUntil !== null && snoozedUntil > nowMs) {
    return false;
  }

  const lastBackupAt = validTimestamp(reminder.lastBackupAt);
  if (lastBackupAt !== null) {
    return nowMs - lastBackupAt >= BACKUP_REMINDER_DAYS * DAY_MS;
  }

  const createdTimes = cards
    .map((card) => validTimestamp(card?.createdAt))
    .filter((value) => value !== null);
  if (!createdTimes.length) {
    return false;
  }

  return nowMs - Math.min(...createdTimes) >= BACKUP_REMINDER_DAYS * DAY_MS;
}

export function createBackupState(now = new Date()) {
  const timestamp = toIsoString(now);
  return {
    lastBackupAt: timestamp,
    snoozedUntil: ""
  };
}

export function createSnoozedBackupState(reminder = {}, now = new Date()) {
  const nowMs = validTimestamp(now);
  const snoozedUntil = new Date((nowMs ?? Date.now()) + BACKUP_SNOOZE_DAYS * DAY_MS).toISOString();
  return {
    lastBackupAt: validIsoString(reminder.lastBackupAt),
    snoozedUntil
  };
}

function validTimestamp(value) {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value).valueOf();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function toIsoString(value) {
  const timestamp = validTimestamp(value);
  return new Date(timestamp ?? Date.now()).toISOString();
}

function validIsoString(value) {
  const timestamp = validTimestamp(value);
  return timestamp === null ? "" : new Date(timestamp).toISOString();
}
