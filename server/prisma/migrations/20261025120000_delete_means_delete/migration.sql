-- "Delete" now removes messages from the database for good. Apply that to what was deleted before:
-- messages deleted for everyone (blanked), messages someone deleted for themselves, and messages from
-- before a member cleared the chat. Reactions, attachments and "hidden" rows go with them (cascade);
-- replies keep their own text. The attachment files are removed by the server at start-up.
DELETE FROM "Message" m
WHERE m."deletedAt" IS NOT NULL
   OR EXISTS (SELECT 1 FROM "HiddenMessage" h WHERE h."messageId" = m."id")
   OR EXISTS (
     SELECT 1 FROM "ConversationMember" cm
     WHERE cm."conversationId" = m."conversationId" AND cm."clearedAt" IS NOT NULL AND m."createdAt" <= cm."clearedAt"
   );

-- Those chats are empty up to that point now; the per-member "cleared" marker is no longer needed.
UPDATE "ConversationMember" SET "clearedAt" = NULL WHERE "clearedAt" IS NOT NULL;
