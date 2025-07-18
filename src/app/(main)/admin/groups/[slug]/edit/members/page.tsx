import prisma from '@/lib/prisma';
import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import { getPublicUrl } from '@/lib/storage';
import GroupMembers, { GroupMember } from '../group-members';

import type { GroupWithMembers } from '@/types/index';

const MEMBERS_PER_PAGE = 25;

export default async function ManageMembersPage({ 
  params: paramsProp,
  searchParams: searchParamsProp,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ page?: string }>;
}) {
  const params = await paramsProp;
  const searchParams = await searchParamsProp;
  const page = Number(searchParams?.page) || 1;

  const session = await auth();
  const isSuperAdmin = session?.user?.isSuperAdmin;

  if (!isSuperAdmin) {
    notFound();
  }

  const group = await prisma.group.findUnique({
    where: { slug: params.slug },
  });

  if (!group) {
    notFound();
  }

  const [totalMembers, members, groupUserRoles, entityTypes, photoTypes] = await prisma.$transaction([
    prisma.groupUser.count({ where: { groupId: group.id } }),
    prisma.groupUser.findMany({
      where: { groupId: group.id },
      include: {
        role: true,
        user: true,
      },
      take: MEMBERS_PER_PAGE,
      skip: (page - 1) * MEMBERS_PER_PAGE,
      orderBy: {
        createdAt: 'desc',
      },
    }),
    prisma.groupUserRole.findMany({ where: { groupId: null } }),
    prisma.entityType.findMany({ where: { groupId: null } }),
    prisma.photoType.findMany({ where: { groupId: null } }),
  ]);

  const userEntityType = entityTypes.find(et => et.code === 'user');
  const primaryPhotoType = photoTypes.find(pt => pt.code === 'primary');

  const userIds = members.map((member) => member.userId);
  const photos = await prisma.photo.findMany({
    where: {
      entityId: { in: userIds },
      entityTypeId: userEntityType?.id,
      typeId: primaryPhotoType?.id,
    },
    select: {
      entityId: true,
      url: true,
    },
  });

  const photoUrlMap = new Map<string, string>();
  for (const photo of photos) {
    if (photo.entityId) {
      photoUrlMap.set(photo.entityId, photo.url);
    }
  }

  const totalPages = Math.ceil(totalMembers / MEMBERS_PER_PAGE);
  const isGlobalAdminGroup = group.slug === 'global-admin';

  const membersWithPhoto = await Promise.all(members.map(async (member) => {
    const rawUrl = photoUrlMap.get(member.userId);
    let photoUrl: string;
    if (rawUrl) {
      if (rawUrl.startsWith('http')) {
        photoUrl = rawUrl;
      } else {
        photoUrl = await getPublicUrl(rawUrl);
      }
    } else {
      photoUrl = `https://api.dicebear.com/8.x/personas/png?seed=${member.user.id}`;
    }
    return {
      ...member,
      user: {
        ...member.user,
        photoUrl,
      },
    };
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-4">Manage Members for {group.name}</h1>
      <GroupMembers
        group={group as GroupWithMembers}
        members={membersWithPhoto as GroupMember[]}
        totalMembers={totalMembers}
        isSuperAdmin={isSuperAdmin}
        isGlobalAdminGroup={isGlobalAdminGroup}
        page={page}
        totalPages={totalPages}
        groupUserRoles={groupUserRoles}
      />
    </div>
  );
}