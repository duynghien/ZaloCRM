/**
 * Prisma Database Seeder.
 * Seeds initial demo organization and administrator account if database is empty.
 * Run via: npm run db:seed
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';

const connectionString = process.env.DATABASE_URL || 'postgresql://crmuser:password@localhost:5432/zalocrm';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Starting database seeding...');

  // Check if any organization exists
  let org = await prisma.organization.findFirst();
  if (!org) {
    org = await prisma.organization.create({
      data: {
        name: 'Default Organization',
      },
    });
    console.log(`✅ Created default organization: "${org.name}" (${org.id})`);
  } else {
    console.log(`ℹ️ Organization already exists: "${org.name}" (${org.id})`);
  }

  // Check if any owner/admin user exists
  const userCount = await prisma.user.count({
    where: { orgId: org.id },
  });

  if (userCount === 0) {
    const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin@123456';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    const adminUser = await prisma.user.create({
      data: {
        orgId: org.id,
        email: 'admin@zalocrm.local',
        fullName: 'System Administrator',
        passwordHash,
        role: 'owner',
        isActive: true,
      },
    });

    console.log(`✅ Created default admin user: ${adminUser.email} (Password: ${defaultPassword})`);
    console.log('⚠️ Please change the default admin password upon first login!');
  } else {
    console.log(`ℹ️ Found ${userCount} existing user(s) in organization. Skipping user seeding.`);
  }

  console.log('🎉 Database seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
