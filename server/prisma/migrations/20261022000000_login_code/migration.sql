-- Phone OTP login is replaced by a personal login code per user.
DROP INDEX IF EXISTS "User_phone_key";
ALTER TABLE "User" DROP COLUMN "phone",
DROP COLUMN "phoneVerifiedAt",
ADD COLUMN "loginCodeHash" TEXT,
ADD COLUMN "loginCodeEnc" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_loginCodeHash_key" ON "User"("loginCodeHash");
