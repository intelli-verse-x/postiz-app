import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  BadRequestException,
} from '@nestjs/common';
import { ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { ProvisionBrandDto } from '@gitroom/nestjs-libraries/dtos/brands/provision.brand.dto';
import {
  isValidPostizAppId,
  normalizeAppId,
} from '@gitroom/nestjs-libraries/app-id/app-ids';

/**
 * Internal brand provision for Admin Dashboard / n8n / Content Factory.
 * Auth: Authorization: Bearer $POSTIZ_INTERNAL_TOKEN
 */
@ApiTags('Internal Brands')
@ApiExcludeController()
@Controller('/internal/brands')
export class BrandsController {
  constructor(private _organizationService: OrganizationService) {}

  private assertInternal(authHeader?: string) {
    const expected = String(process.env.POSTIZ_INTERNAL_TOKEN || '').trim();
    if (!expected) {
      throw new ForbiddenException('POSTIZ_INTERNAL_TOKEN not configured');
    }
    const token = String(authHeader || '')
      .replace(/^Bearer\s+/i, '')
      .trim();
    if (!token || token !== expected) {
      throw new ForbiddenException('invalid internal token');
    }
  }

  @Get('/:appId')
  async getByAppId(
    @Headers('authorization') authorization: string,
    @Param('appId') appIdRaw: string
  ) {
    this.assertInternal(authorization);
    const appId = normalizeAppId(appIdRaw);
    if (!isValidPostizAppId(appId)) {
      throw new BadRequestException(`invalid_app_id:${appId}`);
    }
    const org = await this._organizationService.getOrgByAppId(appId);
    if (!org) {
      return { ok: false, found: false, appId };
    }
    return {
      ok: true,
      found: true,
      appId: org.appId,
      orgId: org.id,
      name: org.name,
      hasApiKey: Boolean(org.apiKey),
      ownerEmail: org.users?.[0]?.user?.email || null,
    };
  }

  @Post('/provision')
  async provision(
    @Headers('authorization') authorization: string,
    @Body() body: ProvisionBrandDto
  ) {
    this.assertInternal(authorization);
    try {
      const result = await this._organizationService.provisionBrand(body);
      return { ok: true, ...result };
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.startsWith('invalid_app_id:')) {
        throw new BadRequestException(msg);
      }
      // Unique email / unique appId race
      if (msg.includes('Unique constraint') || msg.includes('P2002')) {
        const existing = await this._organizationService.getOrgByAppId(
          normalizeAppId(body.appId)
        );
        if (existing) {
          return {
            ok: true,
            created: false,
            orgId: existing.id,
            appId: existing.appId,
            name: existing.name,
            apiKey: existing.apiKey,
            ownerEmail: existing.users?.[0]?.user?.email || body.ownerEmail,
          };
        }
      }
      throw e;
    }
  }
}
