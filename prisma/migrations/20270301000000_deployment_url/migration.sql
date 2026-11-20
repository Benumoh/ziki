-- The live link (#live-link): where a Live issue's merged work can be seen running, given with a deployment report.
ALTER TABLE "DeploymentReport" ADD COLUMN "url" TEXT;
