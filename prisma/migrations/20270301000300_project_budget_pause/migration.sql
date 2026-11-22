-- Project budgets (#project-budget): when the owner paused a project's budget. Additive; null means not paused.
ALTER TABLE "Project" ADD COLUMN "budgetPausedAt" TIMESTAMP(3);
