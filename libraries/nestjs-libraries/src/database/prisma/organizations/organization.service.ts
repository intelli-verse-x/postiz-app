import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { HttpException, Injectable } from '@nestjs/common';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { AddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/add.team.member.dto';
import { AdminAddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/admin.add.team.member.dto';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  Organization,
  Provider,
  ShortLinkPreference,
  User,
} from '@prisma/client';
import {
  isValidPostizAppId,
  normalizeAppId,
  userAppId,
} from '@gitroom/nestjs-libraries/app-id/app-ids';
import { ProvisionBrandDto } from '@gitroom/nestjs-libraries/dtos/brands/provision.brand.dto';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';

@Injectable()
export class OrganizationService {
  constructor(
    private _organizationRepository: OrganizationRepository,
    private _notificationsService: NotificationService
  ) {}
  async createOrgAndUser(
    body: Omit<CreateOrgUserDto, 'providerToken'> & {
      providerId?: string;
      appId?: string;
    },
    ip: string,
    userAgent: string
  ) {
    const created = await this._organizationRepository.createOrgAndUser(
      body,
      this._notificationsService.hasEmailProvider(),
      ip,
      userAgent
    );

    // Self-serve (no brand appId): stamp user_<userId> so orgs never merge.
    if (!created.appId && created.users?.[0]?.user?.id) {
      const stamped = await this.ensureUserAppId(
        created.id,
        created.users[0].user.id
      );
      return { ...created, appId: stamped.appId };
    }

    return created;
  }

  /**
   * If org has no appId yet, set user_<userId>. Never overwrites an existing
   * brand or user appId (old accounts keep data; only get a label).
   */
  async ensureUserAppId(orgId: string, userId: string) {
    const org = await this._organizationRepository.getOrgById(orgId);
    if (!org) {
      throw new Error(`org_not_found:${orgId}`);
    }
    if (org.appId) {
      return org;
    }

    const primary = userAppId(userId);
    try {
      return await this._organizationRepository.setOrgAppId(orgId, primary);
    } catch {
      // Unique race: fall back to user_<userId>_<orgShort>
      const fallback = `${primary}_${String(orgId)
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 8)}`;
      return this._organizationRepository.setOrgAppId(orgId, fallback);
    }
  }

  async getCount() {
    return this._organizationRepository.getCount();
  }

  async createMaxUser(
    id: string,
    name: string,
    saasName: string,
    email: string
  ) {
    return this._organizationRepository.createMaxUser(
      id,
      name,
      saasName,
      email
    );
  }

  addUserToOrg(
    userId: string,
    id: string,
    orgId: string,
    role: 'USER' | 'ADMIN'
  ) {
    return this._organizationRepository.addUserToOrg(userId, id, orgId, role);
  }

  getOrgById(id: string) {
    return this._organizationRepository.getOrgById(id);
  }

  getOrgByIdWithSubscription(id: string) {
    return this._organizationRepository.getOrgByIdWithSubscription(id);
  }

  getAccountOverview(orgId: string) {
    return this._organizationRepository.getAccountOverview(orgId);
  }

  getOrgByApiKey(api: string) {
    return this._organizationRepository.getOrgByApiKey(api);
  }

  getOrgByAppId(appId: string) {
    return this._organizationRepository.getOrgByAppId(normalizeAppId(appId));
  }

  /**
   * Idempotent brand onboard: one Organization per appId.
   * Returns existing org if appId already provisioned.
   */
  async provisionBrand(
    dto: ProvisionBrandDto,
    ip = '0.0.0.0',
    userAgent = 'provision'
  ) {
    const appId = normalizeAppId(dto.appId);
    if (!isValidPostizAppId(appId)) {
      throw new Error(`invalid_app_id:${appId}`);
    }

    const existing = await this.getOrgByAppId(appId);
    if (existing) {
      if (!existing.apiKey) {
        await this.updateApiKey(existing.id);
      }
      const refreshed = await this.getOrgByAppId(appId);
      return {
        created: false,
        orgId: refreshed!.id,
        appId: refreshed!.appId,
        name: refreshed!.name,
        apiKey: refreshed!.apiKey,
        ownerEmail: refreshed!.users?.[0]?.user?.email || dto.ownerEmail,
      };
    }

    const password = dto.password || makeId(24);
    const created = await this.createOrgAndUser(
      {
        company: dto.label,
        email: dto.ownerEmail.toLowerCase().trim(),
        password,
        provider: Provider.LOCAL,
        appId,
        datafast_visitor_id: '',
      },
      ip,
      userAgent
    );

    return {
      created: true,
      orgId: created.id,
      appId: created.appId,
      name: created.name,
      apiKey: created.apiKey,
      ownerEmail: dto.ownerEmail.toLowerCase().trim(),
      ownerPassword: password,
    };
  }

  async canUseSuperAdminApi(orgId: string) {
    const [superAdmin, privilegedOther] = await Promise.all([
      this._organizationRepository.getSuperAdminUser(orgId),
      this._organizationRepository.getPrivilegedNonSuperAdminUser(orgId),
    ]);

    return !!superAdmin && !privilegedOther;
  }

  getUserOrg(id: string) {
    return this._organizationRepository.getUserOrg(id);
  }

  getOrgsByUserId(userId: string) {
    return this._organizationRepository.getOrgsByUserId(userId);
  }

  updateApiKey(orgId: string) {
    return this._organizationRepository.updateApiKey(orgId);
  }

  getTeam(orgId: string) {
    return this._organizationRepository.getTeam(orgId);
  }

  async setStreak(organizationId: string, type: 'start' | 'end') {
    return this._organizationRepository.setStreak(organizationId, type);
  }

  async getLastPublishDate(organizationId: string) {
    return this._organizationRepository.getLastPublishDate(organizationId);
  }

  getOrgByCustomerId(customerId: string) {
    return this._organizationRepository.getOrgByCustomerId(customerId);
  }

  async inviteTeamMember(
    org: Organization,
    user: User,
    body: AddTeamMemberDto
  ) {
    const timeLimit = dayjs().add(2, 'day').format('YYYY-MM-DD HH:mm:ss');
    const id = makeId(5);
    // only the invite fields, the body can carry undeclared properties
    const url =
      process.env.FRONTEND_URL +
      `/?org=${AuthService.signJWT({
        email: body.email,
        role: body.role,
        orgId: org.id,
        timeLimit,
        id,
      })}`;
    if (body.sendEmail) {
      const inviter = user.name ? `${user.name} (${user.email})` : user.email;
      await this._notificationsService.sendEmail(
        body.email,
        `${user.name || user.email} invited you to join "${org.name}"`,
        `${inviter} has invited you to join the "${org.name}" team.<br /><a href="${url}">Accept the invitation</a> to get started.<br />The link will expire in 2 days.`
      );
    }
    return { url };
  }

  async addTeamMemberByEmail(org: Organization, body: AdminAddTeamMemberDto) {
    const tier =
      // @ts-ignore
      org?.subscription?.subscriptionTier ||
      (!process.env.STRIPE_PUBLISHABLE_KEY ? 'ULTIMATE' : 'FREE');

    if (!pricing[tier].team_members) {
      throw new HttpException(
        'The organization plan does not include team members',
        400
      );
    }

    const users = await this._organizationRepository.getUsersByEmail(
      body.email
    );
    if (!users.length) {
      throw new HttpException('No Postiz account found for this email', 400);
    }

    if (users.length > 1) {
      throw new HttpException(
        'Multiple accounts exist for this email (different login providers)',
        400
      );
    }

    const [user] = users;

    const userOrgs = await this._organizationRepository.getOrgsByUserId(
      user.id
    );
    if (userOrgs.some((current) => current.id === org.id)) {
      throw new HttpException(
        'User is already a member of this organization',
        400
      );
    }

    const added = await this._organizationRepository.addUserToOrg(
      user.id,
      makeId(5),
      org.id,
      body.role as 'USER' | 'ADMIN'
    );

    if (!added) {
      throw new HttpException(
        'Could not add the user to the organization',
        400
      );
    }

    return { added: true };
  }

  async deleteTeamMember(org: Organization, userId: string) {
    const userOrgs = await this._organizationRepository.getOrgsByUserId(userId);
    const findOrgToDelete = userOrgs.find((orgUser) => orgUser.id === org.id);
    if (!findOrgToDelete) {
      throw new Error('User is not part of this organization');
    }

    // @ts-ignore
    const myRole = org.users[0].role;
    const userRole = findOrgToDelete.users[0].role;
    const myLevel = myRole === 'USER' ? 0 : myRole === 'ADMIN' ? 1 : 2;
    const userLevel = userRole === 'USER' ? 0 : userRole === 'ADMIN' ? 1 : 2;

    if (myLevel < userLevel) {
      throw new Error('You do not have permission to delete this user');
    }

    return this._organizationRepository.deleteTeamMember(org.id, userId);
  }

  disableOrEnableNonSuperAdminUsers(orgId: string, disable: boolean) {
    return this._organizationRepository.disableOrEnableNonSuperAdminUsers(
      orgId,
      disable
    );
  }

  getShortlinkPreference(orgId: string) {
    return this._organizationRepository.getShortlinkPreference(orgId);
  }

  updateShortlinkPreference(orgId: string, shortlink: ShortLinkPreference) {
    return this._organizationRepository.updateShortlinkPreference(
      orgId,
      shortlink
    );
  }
}
