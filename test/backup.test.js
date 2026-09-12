const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const backupSource = fs.readFileSync(path.resolve(__dirname, "../src/backup.js"), "utf8");

function loadBackupModule() {
  const context = { Date };
  const runnableSource = backupSource
    .replace("export const BACKUP_REMINDER_CARD_COUNT", "const BACKUP_REMINDER_CARD_COUNT")
    .replace("export const BACKUP_REMINDER_DAYS", "const BACKUP_REMINDER_DAYS")
    .replace("export const BACKUP_SNOOZE_DAYS", "const BACKUP_SNOOZE_DAYS")
    .replace("export function shouldShowBackupReminder", "function shouldShowBackupReminder")
    .replace("export function createBackupState", "function createBackupState")
    .replace("export function createSnoozedBackupState", "function createSnoozedBackupState");
  vm.runInNewContext(
    `${runnableSource}\nthis.exports = { shouldShowBackupReminder, createBackupState, createSnoozedBackupState };`,
    context,
    { filename: "src/backup.js" }
  );
  return context.exports;
}

function cards(count, createdAt) {
  return Array.from({ length: count }, (_, index) => ({ id: String(index), createdAt }));
}

test("backup reminder waits for a useful library and thirty days", () => {
  const { shouldShowBackupReminder } = loadBackupModule();
  const now = new Date("2026-10-15T00:00:00.000Z");

  assert.equal(shouldShowBackupReminder(cards(9, "2026-01-01T00:00:00.000Z"), {}, now), false);
  assert.equal(shouldShowBackupReminder(cards(10, "2026-10-01T00:00:00.000Z"), {}, now), false);
  assert.equal(shouldShowBackupReminder(cards(10, "2026-09-01T00:00:00.000Z"), {}, now), true);
});

test("recent backups and snoozes suppress the reminder", () => {
  const { shouldShowBackupReminder, createBackupState, createSnoozedBackupState } = loadBackupModule();
  const now = new Date("2026-10-15T00:00:00.000Z");
  const oldCards = cards(10, "2026-01-01T00:00:00.000Z");

  const backedUp = createBackupState(now);
  assert.equal(shouldShowBackupReminder(oldCards, backedUp, now), false);

  const snoozed = createSnoozedBackupState({}, now);
  assert.equal(shouldShowBackupReminder(oldCards, snoozed, now), false);
  assert.equal(snoozed.snoozedUntil, "2026-10-22T00:00:00.000Z");
});
