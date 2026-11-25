ALTER TABLE "User" ADD COLUMN "googleSubject" TEXT;
CREATE UNIQUE INDEX "User_googleSubject_key" ON "User"("googleSubject");

CREATE TABLE "GoogleSignInChallenge" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionVersion" INTEGER NOT NULL,
    "callbackUrl" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "GoogleSignInChallenge_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GoogleSignInChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GoogleSignInChallenge_tokenHash_key" ON "GoogleSignInChallenge"("tokenHash");
CREATE INDEX "GoogleSignInChallenge_userId_idx" ON "GoogleSignInChallenge"("userId");
CREATE INDEX "GoogleSignInChallenge_expiresAt_idx" ON "GoogleSignInChallenge"("expiresAt");
