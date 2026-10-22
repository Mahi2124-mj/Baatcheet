-- Accounts can be made with just a username and password; e-mail is optional (still unique when set).
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
