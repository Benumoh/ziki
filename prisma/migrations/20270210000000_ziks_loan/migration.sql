-- When a person borrowed Ziks to try Security (16 Nov call). Null if never borrowed.
ALTER TABLE "User" ADD COLUMN "ziksLoanAt" TIMESTAMP(3);
