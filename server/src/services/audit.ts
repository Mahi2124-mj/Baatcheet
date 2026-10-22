import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';

export function audit(actorId: string | null, action: string, targetType?: string, targetId?: string, ip?: string, meta?: Prisma.InputJsonValue) {
  return prisma.auditLog.create({ data: { actorId, action, targetType, targetId, ip, meta } });
}
