import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

const INTERNAL_AUTOMATION_SECRET = process.env.INTERNAL_AUTOMATION_SECRET || '';
const isPublicComment = (method: string, url: string) =>
  method === 'POST' && /^\/public\/posts\/[^/]+\/comments/.test(url);

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  public override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const { url, method } = req;

    if (this.isInternalAutomation(req)) {
      return true;
    }

    if (
      (method === 'POST' && url.includes('/public/v1/posts')) ||
      isPublicComment(method, url)
    ) {
      return super.canActivate(context);
    }

    return true;
  }

  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    if (!req.org) {
      const forwarded = String(req.headers?.['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
      return 'ip_' + (forwarded || req.ip || 'unknown');
    }

    return (
      req.org.id + '_' + (req.url.indexOf('/posts') > -1 ? 'posts' : 'other')
    );
  }

  private isInternalAutomation(req: Request): boolean {
    const automationHeader = req.headers['x-internal-automation'];
    if (
      INTERNAL_AUTOMATION_SECRET &&
      automationHeader === INTERNAL_AUTOMATION_SECRET
    ) {
      return true;
    }

    const forwardedFor = req.headers['x-forwarded-for'] as string | undefined;
    const remoteIp = req.ip || req.socket?.remoteAddress || '';
    const sourceIp = forwardedFor?.split(',')[0]?.trim() || remoteIp;
    if (this.isClusterInternal(sourceIp)) {
      return true;
    }

    return false;
  }

  private isClusterInternal(ip: string): boolean {
    return (
      ip.startsWith('10.') ||
      ip.startsWith('172.') ||
      ip.startsWith('192.168.') ||
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === '::ffff:127.0.0.1'
    );
  }
}

// route-level guard for public endpoints, keyed by the client address the
// proxy forwards rather than the org the global guard expects
@Injectable()
export class ThrottlerRealIpGuard extends ThrottlerGuard {
  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    const forwarded = String(req.headers?.['x-forwarded-for'] || '');
    return forwarded.split(',')[0].trim() || req.ip;
  }
}
