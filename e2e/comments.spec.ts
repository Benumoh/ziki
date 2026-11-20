import { e2eDb } from "./db";
import { test, expect, fileIssue, reportIssue } from "./fixtures";
import { emailFor } from "./users";

test("a report is an idea, on its own page, that takes verdicts, not comments", async ({ page, uniq }) => {
  await reportIssue(page, uniq("Idea verdict check"));
  await expect(page).toHaveURL(/\/ideas\/\d+$/);
  await expect(page.getByRole("heading", { name: /Idea verdicts/i })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add comment" })).toHaveCount(0);
});

test("an issue at Requires confirmation takes confirmations, and replies under them, not comments", async ({ page, uniq, width }) => {
  const url = await fileIssue(page, uniq("Confirmation entry check"));

  // Someone else reported it, so this person is independent and may confirm it.
  const prisma = e2eDb();
  try {
    const other = await prisma.user.findUniqueOrThrow({ where: { email: emailFor("admin", width) }, select: { id: true } });
    const number = Number(new URL(url).pathname.split("/").pop());
    await prisma.bug.updateMany({ where: { number, title: { contains: "Confirmation entry check" } }, data: { reporterId: other.id, beneficiaryUserId: other.id } });
  } finally {
    await prisma.$disconnect();
  }
  await page.reload();

  await expect(page.getByRole("button", { name: "Add comment" })).toHaveCount(0);
  const panel = page.locator("#confirmations");
  await expect(panel.getByRole("heading", { name: /Confirmations/i })).toBeVisible();

  const summary = `Reproduced on Firefox ${Date.now()}.`;
  await page.getByRole("button", { name: "Add confirmation" }).click();
  const dialog = page.getByRole("dialog", { name: "Add confirmation" });
  await dialog.getByText("Confirm", { exact: true }).click();
  await dialog.getByLabel("Summary").fill(summary);
  await dialog.getByLabel("Description").fill("Opened the page, clicked Save, and got a blank page every time.");
  await dialog.getByLabel("Files").fill("app/save/page.tsx:12-30");
  await dialog.getByRole("button", { name: "Give confirmation" }).click();
  await expect(dialog).toBeHidden();
  await expect(panel.getByText(summary)).toBeVisible();

  const reply = `Same on Chrome ${Date.now()}`;
  await panel.getByRole("button", { name: "Reply" }).first().click();
  const replyForm = panel.getByRole("form", { name: "Reply to this confirmation" });
  await replyForm.getByRole("textbox").fill(reply);
  await replyForm.getByRole("button", { name: "Reply" }).click();
  await expect(panel.getByText(reply)).toBeVisible();

  // Both survive a reload: they were saved, not just drawn.
  await page.reload();
  await expect(panel.getByText(summary)).toBeVisible();
  await expect(panel.getByText(reply)).toBeVisible();
});

test("an Open issue says it is waiting for bids and takes comments and replies; in progress it still takes them", async ({ page, uniq }) => {
  const url = await fileIssue(page, uniq("Open comments check"));
  const number = Number(new URL(url).pathname.split("/").pop());
  const setStatus = async (status: "open" | "in_progress") => {
    const prisma = e2eDb();
    try {
      // Open · Open or In progress: the substatus has the same name (#substatus).
      await prisma.bug.updateMany({ where: { number, title: { contains: "Open comments check" } }, data: { status, substatus: status } });
    } finally {
      await prisma.$disconnect();
    }
  };
  await setStatus("open");
  await page.reload();

  // Nobody has it: there is no award box.
  await expect(page.getByTestId("award-box")).toHaveCount(0);

  const comments = page.getByTestId("issue-comments");
  const body = `Same here on Firefox ${Date.now()}`;
  await comments.getByRole("form", { name: "Add a comment" }).getByRole("textbox").fill(body);
  await comments.getByRole("button", { name: "Comment", exact: true }).click();
  // The reply below quotes the comment, so match the comment itself: the first.
  await expect(comments.getByText(body).first()).toBeVisible();

  const reply = `Fixed by clearing the cache ${Date.now()}`;
  await comments.getByRole("button", { name: "Reply" }).first().click();
  const replyForm = comments.getByRole("form", { name: "Reply to this comment" });
  await replyForm.getByRole("textbox").fill(reply);
  await replyForm.getByRole("button", { name: "Reply" }).click();
  await expect(comments.getByText(reply)).toBeVisible();

  // Both survive a reload: they were saved, not just drawn.
  await page.reload();
  await expect(comments.getByText(body).first()).toBeVisible();
  await expect(comments.getByText(reply)).toBeVisible();

  // In progress, the comments stay and the issue still takes new ones: helpful comments are welcome at any stage.
  await setStatus("in_progress");
  await page.reload();
  await expect(comments.getByText(body).first()).toBeVisible();
  await expect(comments.getByRole("form", { name: "Add a comment" })).toHaveCount(1);
});
