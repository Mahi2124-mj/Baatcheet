// Development data: fictional users and chats. Every seeded account uses the password below.
import { PrismaClient } from '@prisma/client';
import { hash } from '@node-rs/argon2';

const prisma = new PrismaClient();
const PASSWORD = 'Password123';

const people = [
  { username: 'asha', displayName: 'Asha Verma', email: 'asha@example.test', role: 'ADMIN' as const },
  { username: 'ravi', displayName: 'Ravi Kumar', email: 'ravi@example.test' },
  { username: 'meera', displayName: 'Meera Joshi', email: 'meera@example.test' },
  { username: 'kabir', displayName: 'Kabir Singh', email: 'kabir@example.test' },
];

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database');
  const passwordHash = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  const users = [];
  for (const p of people) {
    users.push(
      await prisma.user.upsert({
        where: { email: p.email },
        update: {},
        create: {
          email: p.email,
          emailVerifiedAt: new Date(),
          passwordHash,
          role: p.role ?? 'USER',
          profile: { create: { username: p.username, displayName: p.displayName, onboarded: true, bio: 'Fictional test account' } },
        },
      }),
    );
  }
  const [asha, ravi, meera, kabir] = users;
  for (const [x, y] of [[asha, ravi], [asha, meera], [asha, kabir], [ravi, meera]]) {
    for (const [o, c] of [[x, y], [y, x]]) {
      await prisma.contact.upsert({ where: { ownerId_contactId: { ownerId: o.id, contactId: c.id } }, update: {}, create: { ownerId: o.id, contactId: c.id } });
    }
  }
  const key = asha.id < ravi.id ? `${asha.id}:${ravi.id}` : `${ravi.id}:${asha.id}`;
  const direct = await prisma.conversation.upsert({
    where: { directKey: key },
    update: {},
    create: { type: 'DIRECT', directKey: key, createdById: asha.id, members: { create: [{ userId: asha.id }, { userId: ravi.id }] } },
  });
  const lines: [string, string][] = [
    [asha.id, 'Hi Ravi! Did you get the train tickets?'],
    [ravi.id, 'Yes, Friday 7:15 am 🚆'],
    [asha.id, 'Perfect, see you at the station.'],
  ];
  if (!(await prisma.message.count({ where: { conversationId: direct.id } }))) {
    for (const [i, [senderId, body]] of lines.entries()) {
      await prisma.message.create({ data: { conversationId: direct.id, senderId, body, createdAt: new Date(Date.now() - (lines.length - i) * 60_000) } });
    }
  }
  if (!(await prisma.conversation.count({ where: { type: 'GROUP', name: 'Weekend Trip' } }))) {
    const g = await prisma.conversation.create({
      data: {
        type: 'GROUP',
        name: 'Weekend Trip',
        createdById: asha.id,
        members: { create: [{ userId: asha.id, role: 'OWNER' }, { userId: ravi.id, role: 'ADMIN' }, { userId: meera.id }, { userId: kabir.id }] },
      },
    });
    await prisma.message.create({ data: { conversationId: g.id, kind: 'SYSTEM', body: 'Asha Verma created the group “Weekend Trip”' } });
    await prisma.message.create({ data: { conversationId: g.id, senderId: meera.id, body: 'Who is bringing the snacks? 🍿' } });
  }
  console.log(`Seeded ${users.length} users. Log in with e.g. asha@example.test / ${PASSWORD} (asha is an admin).`);
}

main().finally(() => prisma.$disconnect());
