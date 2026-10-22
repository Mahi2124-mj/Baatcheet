-- The generated login code is replaced by a PIN the user sets after logging in.
DROP INDEX IF EXISTS "User_loginCodeHash_key";
ALTER TABLE "User" DROP COLUMN "loginCodeHash",
DROP COLUMN "loginCodeEnc",
ADD COLUMN "pinHash" TEXT,
ADD COLUMN "pinFails" INTEGER NOT NULL DEFAULT 0;

-- Deleting a call from one's own call history.
ALTER TABLE "CallParticipant" ADD COLUMN "hiddenAt" TIMESTAMP(3);
