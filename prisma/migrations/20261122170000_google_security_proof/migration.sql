CREATE TABLE "GoogleSecurityProof" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "googleSubject" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "GoogleSecurityProof_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GoogleSecurityProof_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GoogleSecurityProof_tokenHash_key" ON "GoogleSecurityProof"("tokenHash");
CREATE INDEX "GoogleSecurityProof_userId_idx" ON "GoogleSecurityProof"("userId");
CREATE INDEX "GoogleSecurityProof_expiresAt_idx" ON "GoogleSecurityProof"("expiresAt");
