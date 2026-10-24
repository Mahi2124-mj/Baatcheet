-- "Delete for me": messages a user removed from their own view.
CREATE TABLE "HiddenMessage" (
    "userId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HiddenMessage_pkey" PRIMARY KEY ("userId","messageId")
);

-- CreateIndex
CREATE INDEX "HiddenMessage_messageId_idx" ON "HiddenMessage"("messageId");

-- AddForeignKey
ALTER TABLE "HiddenMessage" ADD CONSTRAINT "HiddenMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HiddenMessage" ADD CONSTRAINT "HiddenMessage_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
